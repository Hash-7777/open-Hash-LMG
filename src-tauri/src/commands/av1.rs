// AV1 for WebM: frames of RGBA pixels in, the compressed stream out, by an
// encoder written in Rust and built into the app.
//
// The encoder looks ahead before it hands a frame back, so each frame sent may
// return none, one or several packets, and the last ones come out when the
// session ends. Every packet goes back framed as
//   [1 byte: 1 for a key frame][4 bytes: length, little end first]
//   [8 bytes: the frame's number in the film][the packet]
// and the end of the session also returns the stream's description for the
// WebM file, first, as [4 bytes: length][description].

use rav1e::color::{
    ColorDescription, ColorPrimaries, MatrixCoefficients, PixelRange, TransferCharacteristics,
};
use rav1e::config::SpeedSettings;
use rav1e::prelude::{ChromaSampling, Config, Context, EncoderConfig, EncoderStatus, FrameType, Rational};

use super::encode::check_size;

pub struct Av1 {
    ctx: Context<u8>,
    pub width: u32,
    pub height: u32,
}

// The encoder's speed, 0 (slowest) to 10: fast enough for a minute of film
// in a few minutes, where its pictures are still clean.
const SPEED: u8 = 10;

impl Av1 {
    pub fn open(width: u32, height: u32, fps: f32, bitrate: u32, keyint: u32) -> Result<Self, String> {
        check_size(width, height)?;
        let fps_milli = (fps.clamp(1.0, 240.0) * 1000.0).round() as u64;
        let enc = EncoderConfig {
            width: width as usize,
            height: height as usize,
            time_base: Rational::new(1000, fps_milli),
            bit_depth: 8,
            chroma_sampling: ChromaSampling::Cs420,
            pixel_range: PixelRange::Limited,
            color_description: Some(ColorDescription {
                color_primaries: ColorPrimaries::BT709,
                transfer_characteristics: TransferCharacteristics::BT709,
                matrix_coefficients: MatrixCoefficients::BT709,
            }),
            min_key_frame_interval: 12,
            max_key_frame_interval: u64::from(keyint.clamp(12, 600)),
            bitrate: bitrate.clamp(200_000, 100_000_000) as i32,
            speed_settings: SpeedSettings::from_preset(SPEED),
            // The frame split into tiles the processor's cores encode side by side.
            tiles: 16,
            ..Default::default()
        };
        let ctx = Config::new()
            .with_encoder_config(enc)
            .new_context()
            .map_err(|e| format!("The AV1 encoder could not start: {e}"))?;
        Ok(Self { ctx, width, height })
    }

    /// One frame; returns the packets ready so far, framed.
    pub fn frame(&mut self, rgba: &[u8]) -> Result<Vec<u8>, String> {
        let (w, h) = (self.width as usize, self.height as usize);
        if rgba.len() != w * h * 4 {
            return Err("The frame is not the size the export began with.".into());
        }
        let (y, u, v) = to_yuv420(rgba, w, h);
        let mut f = self.ctx.new_frame();
        f.planes[0].copy_from_raw_u8(&y, w, 1);
        f.planes[1].copy_from_raw_u8(&u, w / 2, 1);
        f.planes[2].copy_from_raw_u8(&v, w / 2, 1);
        self.ctx
            .send_frame(f)
            .map_err(|e| format!("The AV1 encoder failed: {e}"))?;
        self.drain()
    }

    /// The last packets, after the description of the stream.
    pub fn finish(mut self) -> Result<Vec<u8>, String> {
        self.ctx.flush();
        let packets = self.drain()?;
        let header = self.ctx.container_sequence_header();
        let mut out = Vec::with_capacity(4 + header.len() + packets.len());
        out.extend_from_slice(&(header.len() as u32).to_le_bytes());
        out.extend_from_slice(&header);
        out.extend_from_slice(&packets);
        Ok(out)
    }

    fn drain(&mut self) -> Result<Vec<u8>, String> {
        let mut out = Vec::new();
        loop {
            match self.ctx.receive_packet() {
                Ok(p) => {
                    out.push(u8::from(p.frame_type == FrameType::KEY));
                    out.extend_from_slice(&(p.data.len() as u32).to_le_bytes());
                    out.extend_from_slice(&p.input_frameno.to_le_bytes());
                    out.extend_from_slice(&p.data);
                }
                Err(EncoderStatus::Encoded) => continue,
                Err(EncoderStatus::NeedMoreData) | Err(EncoderStatus::LimitReached) => break,
                Err(e) => return Err(format!("The AV1 encoder failed: {e}")),
            }
        }
        Ok(out)
    }
}

/// RGBA to the three planes of 4:2:0 video, limited range, BT.709, as the
/// stream says it is; the colour planes average each square of four pixels.
pub fn to_yuv420(rgba: &[u8], w: usize, h: usize) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let mut y = vec![0u8; w * h];
    let (cw, ch) = (w / 2, h / 2);
    let mut u = vec![0u8; cw * ch];
    let mut v = vec![0u8; cw * ch];
    let luma = |r: f32, g: f32, b: f32| 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for row in 0..h {
        for col in 0..w {
            let i = (row * w + col) * 4;
            let l = luma(rgba[i] as f32, rgba[i + 1] as f32, rgba[i + 2] as f32);
            y[row * w + col] = (16.0 + l * 219.0 / 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    for row in 0..ch {
        for col in 0..cw {
            let (mut r, mut g, mut b) = (0.0f32, 0.0f32, 0.0f32);
            for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                let i = ((row * 2 + dy) * w + col * 2 + dx) * 4;
                r += rgba[i] as f32;
                g += rgba[i + 1] as f32;
                b += rgba[i + 2] as f32;
            }
            let (r, g, b) = (r / 4.0, g / 4.0, b / 4.0);
            let l = luma(r, g, b);
            let cb = (b - l) / 1.8556;
            let cr = (r - l) / 1.5748;
            u[row * cw + col] = (128.0 + cb * 224.0 / 255.0).round().clamp(0.0, 255.0) as u8;
            v[row * cw + col] = (128.0 + cr * 224.0 / 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    (y, u, v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gradient(width: u32, height: u32, shift: u32) -> Vec<u8> {
        let mut v = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                v.extend_from_slice(&[((x + shift) % 256) as u8, (y % 256) as u8, 128, 255]);
            }
        }
        v
    }

    // Reads the framed packets back: (key, frame number, length).
    fn packets(mut b: &[u8]) -> Vec<(bool, u64, usize)> {
        let mut out = Vec::new();
        while b.len() >= 13 {
            let len = u32::from_le_bytes([b[1], b[2], b[3], b[4]]) as usize;
            let n = u64::from_le_bytes(b[5..13].try_into().unwrap());
            out.push((b[0] == 1, n, len));
            b = &b[13 + len..];
        }
        assert!(b.is_empty(), "the framing adds up");
        out
    }

    #[test]
    fn every_frame_comes_back_once_in_order_the_first_a_key_frame() {
        let (w, h) = (64, 48);
        let mut enc = Av1::open(w, h, 30.0, 500_000, 60).expect("encoder");
        let mut got = Vec::new();
        for i in 0..10 {
            got.extend(packets(&enc.frame(&gradient(w, h, i * 3)).expect("frame")));
        }
        let end = enc.finish().expect("finish");
        let hlen = u32::from_le_bytes(end[..4].try_into().unwrap()) as usize;
        let header = &end[4..4 + hlen];
        // The description WebM carries: av1C, version 1.
        assert_eq!(header[0], 0x81);
        got.extend(packets(&end[4 + hlen..]));
        assert_eq!(got.iter().map(|p| p.1).collect::<Vec<_>>(), (0..10).collect::<Vec<_>>());
        assert!(got[0].0);
        assert!(got.iter().all(|p| p.2 > 0));
    }

    #[test]
    fn colours_land_in_limited_range() {
        let px = [255u8, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255];
        let (y, u, v) = to_yuv420(&px, 2, 2);
        assert_eq!(y, vec![235, 16, 235, 16]);
        assert_eq!((u[0], v[0]), (128, 128));
    }

    #[test]
    fn a_frame_of_the_wrong_size_is_refused() {
        let mut enc = Av1::open(64, 64, 30.0, 500_000, 60).expect("encoder");
        assert!(enc.frame(&[0u8; 10]).is_err());
    }
}
