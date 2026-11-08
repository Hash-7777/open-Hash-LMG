// The encoders' own tests: sizes, frames that decode back, the colour the
// H.264 stream says it holds and the level it needs, GIF and MP3.
use super::*;
use openh264::decoder::Decoder;

fn gradient(width: u32, height: u32, shift: u32) -> Vec<u8> {
    let mut v = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            v.extend_from_slice(&[((x + shift) % 256) as u8, (y % 256) as u8, 128, 255]);
        }
    }
    v
}

#[test]
fn sizes_outside_the_encoder_are_refused() {
    assert!(check_size(1920, 1080).is_ok());
    assert!(check_size(3840, 2160).is_ok());
    assert!(check_size(1921, 1080).is_err());
    assert!(check_size(8, 8).is_err());
    assert!(check_size(8192, 4320).is_err());
}

#[test]
fn h264_frames_decode_back_to_pictures_of_the_same_size() {
    let (w, h) = (320, 180);
    let mut enc = h264_encoder(w, h, 30.0, 2_000_000, 30).expect("encoder");
    let mut yuv = YUVBuffer::new(w as usize, h as usize);
    let mut dec = Decoder::new().expect("decoder");
    let mut keys = 0;
    let mut pictures = 0;
    for i in 0..12 {
        let (bytes, key) =
            h264_frame(&mut enc, &mut yuv, w, h, &gradient(w, h, i * 4), i == 6).expect("frame");
        assert!(!bytes.is_empty());
        if key {
            keys += 1;
        }
        if let Ok(Some(picture)) = dec.decode(&bytes) {
            use openh264::formats::YUVSource;
            assert_eq!(picture.dimensions(), (w as usize, h as usize));
            pictures += 1;
        }
    }
    assert!(
        keys >= 2,
        "the first frame and the forced one are key frames"
    );
    assert_eq!(pictures, 12);
}

// Reads an SPS far enough to find its profile, its level and the colour
// description in its VUI.
struct Bits<'a> {
    b: &'a [u8],
    at: usize,
}
impl Bits<'_> {
    fn bit(&mut self) -> u32 {
        let v = (self.b[self.at / 8] >> (7 - self.at % 8)) & 1;
        self.at += 1;
        v as u32
    }
    fn bits(&mut self, n: u32) -> u32 {
        (0..n).fold(0, |a, _| (a << 1) | self.bit())
    }
    fn ue(&mut self) -> u32 {
        let mut z = 0;
        while self.bit() == 0 {
            z += 1;
        }
        (1 << z) - 1 + self.bits(z)
    }
    fn se(&mut self) -> i32 {
        let k = self.ue() as i32;
        if k % 2 == 1 {
            (k + 1) / 2
        } else {
            -k / 2
        }
    }
}
// Primaries, transfer, matrix, and whether the range is full.
type Colour = (u32, u32, u32, u32);

fn sps_of(stream: &[u8]) -> (u8, u8, Option<Colour>) {
    let at = stream
        .windows(4)
        .position(|w| w[..3] == [0, 0, 1] && w[3] & 0x1f == 7)
        .expect("an SPS")
        + 4;
    // Emulation prevention bytes out.
    let mut rbsp = Vec::new();
    let mut zeros = 0;
    for &x in &stream[at..] {
        if zeros >= 2 && x == 3 {
            zeros = 0;
            continue;
        }
        if zeros >= 2 && x <= 1 {
            break;
        }
        zeros = if x == 0 { zeros + 1 } else { 0 };
        rbsp.push(x);
    }
    let (profile, level) = (rbsp[0], rbsp[2]);
    let mut r = Bits {
        b: &rbsp[3..],
        at: 0,
    };
    r.ue();
    if [100, 110, 122, 244, 44, 83, 86, 118, 128].contains(&profile) {
        assert_eq!(r.ue(), 1);
        r.ue();
        r.ue();
        r.bit();
        assert_eq!(r.bit(), 0);
    }
    r.ue();
    let poc = r.ue();
    if poc == 0 {
        r.ue();
    } else if poc == 1 {
        r.bit();
        r.se();
        r.se();
        for _ in 0..r.ue() {
            r.se();
        }
    }
    r.ue();
    r.bit();
    r.ue();
    r.ue();
    if r.bit() == 0 {
        r.bit();
    }
    r.bit();
    if r.bit() == 1 {
        r.ue();
        r.ue();
        r.ue();
        r.ue();
    }
    if r.bit() == 0 {
        return (profile, level, None);
    }
    if r.bit() == 1 && r.bits(8) == 255 {
        r.bits(32);
    }
    if r.bit() == 1 {
        r.bit();
    }
    if r.bit() == 0 {
        return (profile, level, None);
    }
    r.bits(3);
    let full = r.bit();
    if r.bit() == 0 {
        return (profile, level, None);
    }
    (
        profile,
        level,
        Some((r.bits(8), r.bits(8), r.bits(8), full)),
    )
}

#[test]
fn h264_says_bt709_limited_range_and_a_level_the_size_needs() {
    // Level 4.2 is the least that holds 1080p at 60; 5.1 holds 4K at 30.
    for (w, h, fps, least) in [(1920u32, 1080u32, 60.0f32, 42u8), (3840, 2160, 30.0, 51)] {
        let mut enc = h264_encoder(w, h, fps, 20_000_000, 30).expect("encoder");
        let mut yuv = YUVBuffer::new(w as usize, h as usize);
        let (bytes, key) =
            h264_frame(&mut enc, &mut yuv, w, h, &gradient(w, h, 0), true).expect("frame");
        assert!(key);
        let (_, level, colour) = sps_of(&bytes);
        assert_eq!(
            colour,
            Some((1, 1, 1, 0)),
            "BT.709 primaries, transfer and matrix, limited range"
        );
        assert!(level >= least, "level {level} for {w} by {h} at {fps}");
    }
}

#[test]
fn h264_colours_are_converted_as_bt709() {
    // A flat colour encoded and decoded comes back within a few steps when
    // read with BT.709, as every player reads it from the label.
    let (w, h) = (64u32, 64u32);
    let red = [233u8, 66, 63, 255].repeat((w * h) as usize);
    let mut enc = h264_encoder(w, h, 30.0, 8_000_000, 30).expect("encoder");
    let mut yuv = YUVBuffer::new(w as usize, h as usize);
    let (bytes, _) = h264_frame(&mut enc, &mut yuv, w, h, &red, true).expect("frame");
    let mut dec = Decoder::new().expect("decoder");
    let pic = dec.decode(&bytes).expect("decode").expect("a picture");
    use openh264::formats::YUVSource;
    let (ys, us, vs) = pic.strides();
    let (yy, cb, cr) = (
        pic.y()[32 * ys + 32] as f32,
        pic.u()[16 * us + 16] as f32,
        pic.v()[16 * vs + 16] as f32,
    );
    let l = (yy - 16.0) * 255.0 / 219.0;
    let (pb, pr) = ((cb - 128.0) * 255.0 / 224.0, (cr - 128.0) * 255.0 / 224.0);
    let r = l + 1.5748 * pr;
    let b = l + 1.8556 * pb;
    let g = (l - 0.2126 * r - 0.0722 * b) / 0.7152;
    for (got, want) in [(r, 233.0), (g, 66.0), (b, 63.0)] {
        assert!((got - want).abs() <= 4.0, "{got} for {want}");
    }
}

#[test]
fn a_frame_of_the_wrong_size_is_refused() {
    let mut enc = h264_encoder(64, 64, 30.0, 1_000_000, 30).expect("encoder");
    let mut yuv = YUVBuffer::new(64, 64);
    assert!(h264_frame(&mut enc, &mut yuv, 64, 64, &[0u8; 10], false).is_err());
}

#[test]
fn gif_frames_make_a_gif_file() {
    let mut enc = gif::Encoder::new(Vec::new(), 32, 16, &[]).expect("gif");
    for i in 0..3 {
        let mut px = gradient(32, 16, i * 20);
        enc.write_frame(&gif::Frame::from_rgba_speed(32, 16, &mut px, 10))
            .expect("frame");
    }
    let bytes = enc.into_inner().expect("finish");
    assert_eq!(&bytes[..6], b"GIF89a");
}

#[test]
fn sound_becomes_mp3_frames() {
    let n = 48_000;
    let left: Vec<f32> = (0..n).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
    let bytes = mp3(&left, &left, 48_000).expect("mp3");
    assert!(bytes.len() > 1000);
    // Every MP3 frame starts with eleven set bits.
    assert_eq!(bytes[0], 0xFF);
    assert_eq!(bytes[1] & 0xE0, 0xE0);
}

#[test]
fn gif_delays_add_up_to_the_film_s_length() {
    for fps in [12.0f32, 15.0, 24.0, 30.0] {
        let n = (fps * 30.0) as u32;
        let total: u32 = (0..n).map(|i| gif_delay(i, fps) as u32).sum();
        assert_eq!(total, 3000, "{fps} frames a second");
    }
    assert!(gif_delay(0, 60.0) >= 2);
}
