// The app's own encoders, the same on every system.
//
// A web view's video encoder is missing on some systems and unreliable on
// others, so the film is encoded here instead, by encoders built into the app
// from source: H.264 for MP4 and MOV, AV1 for WebM (av1.rs), GIF, and MP3
// for sound where the system has no AAC encoder of its own (Vorbis for WebM
// is in vorbis.rs). The page draws each frame, sends
// its pixels under a session token, and gets back the encoded stream; it then
// writes the file itself with its own MP4 and MOV writer. Nothing here reads
// or writes a file, and nothing takes a path.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use openh264::encoder::{
    BitRate, Encoder, EncoderConfig, FrameRate, IntraFramePeriod, RateControlMode, SpsPpsStrategy,
    UsageType, VuiConfig,
};
use openh264::formats::YUVBuffer;
use openh264::OpenH264API;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

// The largest frame either encoder takes: 4K at any shape.
const MAX_SIDE: u32 = 4096;
const MAX_PIXELS: u32 = 4096 * 2304;

enum Session {
    // The encoder carries a large state of its own, so it lives on the heap.
    H264 {
        enc: Box<Encoder>,
        yuv: YUVBuffer,
        width: u32,
        height: u32,
    },
    Av1(Box<super::av1::Av1>),
    Gif {
        enc: gif::Encoder<Vec<u8>>,
        width: u16,
        height: u16,
        // Frames written so far, and the frames a second: each frame's delay
        // is what keeps the running total on the film's own clock.
        frames: u32,
        fps: f32,
    },
}

#[derive(Default)]
pub struct Encoders(Mutex<HashMap<String, Session>>);

static COUNTER: AtomicU64 = AtomicU64::new(1);

fn token() -> String {
    let mut h = RandomState::new().build_hasher();
    h.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    format!("{:016x}", h.finish())
}

/// A frame size the encoders take: even sides, within 4K.
pub fn check_size(width: u32, height: u32) -> Result<(), String> {
    if width < 16
        || height < 16
        || width > MAX_SIDE
        || height > MAX_SIDE
        || width * height > MAX_PIXELS
    {
        return Err(format!("{width} by {height} is outside the sizes the encoder takes (16 to 4096 a side, up to 4K)."));
    }
    if !width.is_multiple_of(2) || !height.is_multiple_of(2) {
        return Err("The frame's width and height must be even.".into());
    }
    Ok(())
}

pub fn h264_encoder(
    width: u32,
    height: u32,
    fps: f32,
    bitrate: u32,
    keyint: u32,
) -> Result<Encoder, String> {
    check_size(width, height)?;
    let config = EncoderConfig::new()
        .bitrate(BitRate::from_bps(bitrate.clamp(200_000, 200_000_000)))
        .max_frame_rate(FrameRate::from_hz(fps.clamp(1.0, 240.0)))
        .rate_control_mode(RateControlMode::Bitrate)
        // Every frame is kept: a film never drops one to meet the rate.
        .skip_frames(false)
        .usage_type(UsageType::CameraVideoRealTime)
        // Parameter sets with every key frame, so the stream can start anywhere.
        .sps_pps_strategy(SpsPpsStrategy::ConstantId)
        .intra_frame_period(IntraFramePeriod::from_num_frames(keyint.clamp(1, 600)))
        // The stream says its colours are BT.709, limited range, as HD video
        // is, and as the pixels are converted (av1::to_yuv420).
        .vui(VuiConfig::bt709());
    Encoder::with_api_config(OpenH264API::from_source(), config)
        .map_err(|e| format!("The video encoder could not start: {e}"))
}

/// One frame of RGBA pixels as H.264 in Annex B form (start codes before each
/// unit), and whether it is a key frame.
pub fn h264_frame(
    enc: &mut Encoder,
    yuv: &mut YUVBuffer,
    width: u32,
    height: u32,
    rgba: &[u8],
    key: bool,
) -> Result<(Vec<u8>, bool), String> {
    if rgba.len() != (width * height * 4) as usize {
        return Err("The frame is not the size the export began with.".into());
    }
    // BT.709, as the stream and the file both say; the same conversion as AV1.
    let (y, u, v) = super::av1::to_yuv420(rgba, width as usize, height as usize);
    let mut planes = y;
    planes.extend_from_slice(&u);
    planes.extend_from_slice(&v);
    *yuv = YUVBuffer::from_vec(planes, width as usize, height as usize);
    if key {
        enc.force_intra_frame();
    }
    let stream = enc
        .encode(yuv)
        .map_err(|e| format!("The video encoder failed: {e}"))?;
    let is_key = matches!(
        stream.frame_type(),
        openh264::encoder::FrameType::IDR | openh264::encoder::FrameType::I
    );
    Ok((stream.to_vec(), is_key))
}

fn header(request: &Request<'_>, name: &str) -> Option<String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// A GIF frame's delay in hundredths of a second, the only unit a GIF has:
/// the difference between where this frame and the next start on the film's
/// clock, rounded, so the delays add up to the film's length instead of each
/// rounding the same way. Never under two, which players would slow down.
pub fn gif_delay(frame: u32, fps: f32) -> u16 {
    let at = |n: u32| (n as f64 * 100.0 / fps as f64).round();
    (at(frame + 1) - at(frame)).max(2.0) as u16
}

/// Starts an encoding session. kind: "h264", "av1" or "gif".
#[tauri::command]
pub fn encoder_open(
    encoders: State<'_, Encoders>,
    kind: String,
    width: u32,
    height: u32,
    fps: f32,
    bitrate: u32,
    keyint: u32,
) -> Result<String, String> {
    let session = match kind.as_str() {
        "h264" => {
            let enc = h264_encoder(width, height, fps, bitrate, keyint)?;
            Session::H264 {
                enc: Box::new(enc),
                yuv: YUVBuffer::new(width as usize, height as usize),
                width,
                height,
            }
        }
        "av1" => Session::Av1(Box::new(super::av1::Av1::open(
            width, height, fps, bitrate, keyint,
        )?)),
        "gif" => {
            check_size(width, height)?;
            let (w, h) = (width as u16, height as u16);
            let mut enc = gif::Encoder::new(Vec::new(), w, h, &[])
                .map_err(|e| format!("The GIF encoder could not start: {e}"))?;
            enc.set_repeat(gif::Repeat::Infinite)
                .map_err(|e| e.to_string())?;
            Session::Gif {
                enc,
                width: w,
                height: h,
                frames: 0,
                fps: fps.clamp(1.0, 50.0),
            }
        }
        _ => return Err("The app has no encoder of that kind.".into()),
    };
    let t = token();
    encoders
        .0
        .lock()
        .map_err(|_| "Busy.".to_string())?
        .insert(t.clone(), session);
    Ok(t)
}

/// One frame of RGBA pixels, sent raw with the session in x-encoder and
/// x-key: 1 for a key frame. H.264 answers with one byte (1 for a key frame)
/// and the frame's stream; AV1 with the packets ready so far, framed as av1.rs
/// describes; GIF with nothing until the session closes.
#[tauri::command]
pub fn encoder_frame(
    encoders: State<'_, Encoders>,
    request: Request<'_>,
) -> Result<Response, String> {
    let t = header(&request, "x-encoder").ok_or("The export was not started.")?;
    let key = header(&request, "x-key").as_deref() == Some("1");
    let InvokeBody::Raw(rgba) = request.body() else {
        return Err("The export sent something that is not a frame.".into());
    };
    let mut map = encoders.0.lock().map_err(|_| "Busy.".to_string())?;
    match map.get_mut(&t).ok_or("The export was not started.")? {
        Session::H264 {
            enc,
            yuv,
            width,
            height,
        } => {
            let (bytes, is_key) = h264_frame(enc, yuv, *width, *height, rgba, key)?;
            let mut out = Vec::with_capacity(bytes.len() + 1);
            out.push(u8::from(is_key));
            out.extend_from_slice(&bytes);
            Ok(Response::new(out))
        }
        Session::Av1(enc) => Ok(Response::new(enc.frame(rgba)?)),
        Session::Gif {
            enc,
            width,
            height,
            frames,
            fps,
        } => {
            if rgba.len() != (*width as usize) * (*height as usize) * 4 {
                return Err("The frame is not the size the export began with.".into());
            }
            let mut pixels = rgba.to_vec();
            // Speed 10 of 30: a good palette at a pace a long film can keep.
            let mut frame = gif::Frame::from_rgba_speed(*width, *height, &mut pixels, 10);
            frame.delay = gif_delay(*frames, *fps);
            *frames += 1;
            enc.write_frame(&frame)
                .map_err(|e| format!("The GIF encoder failed: {e}"))?;
            Ok(Response::new(Vec::new()))
        }
    }
}

/// Ends a session. A GIF answers with the whole file; AV1 with its stream's
/// description and the frames it still held; H.264 with nothing, as it holds
/// no frames back.
#[tauri::command]
pub fn encoder_close(encoders: State<'_, Encoders>, token: String) -> Result<Response, String> {
    let session = encoders
        .0
        .lock()
        .map_err(|_| "Busy.".to_string())?
        .remove(&token);
    match session {
        Some(Session::Av1(enc)) => Ok(Response::new(enc.finish()?)),
        Some(Session::Gif { enc, .. }) => {
            Ok(Response::new(enc.into_inner().map_err(|e| {
                format!("The GIF could not be finished: {e}")
            })?))
        }
        _ => Ok(Response::new(Vec::new())),
    }
}

/// Stereo sound as MP3, from 32-bit float samples, left then right channel
/// one after the other, at the rate in x-rate.
pub fn mp3(left: &[f32], right: &[f32], rate: u32) -> Result<Vec<u8>, String> {
    use mp3lame_encoder::{Bitrate, Builder, DualPcm, FlushNoGap, Quality};
    let mut enc = Builder::new()
        .ok_or("The sound encoder could not start.")?
        .with_num_channels(2)
        .and_then(|b| b.with_sample_rate(rate))
        .and_then(|b| b.with_brate(Bitrate::Kbps192))
        .and_then(|b| b.with_quality(Quality::Best))
        .and_then(|b| b.build())
        .map_err(|e| format!("The sound encoder could not start: {e}"))?;
    let mut out = Vec::with_capacity(mp3lame_encoder::max_required_buffer_size(left.len()));
    enc.encode_to_vec(DualPcm { left, right }, &mut out)
        .map_err(|e| format!("The sound encoder failed: {e}"))?;
    enc.flush_to_vec::<FlushNoGap>(&mut out)
        .map_err(|e| format!("The sound encoder failed: {e}"))?;
    Ok(out)
}

#[tauri::command]
pub fn mp3_encode(request: Request<'_>) -> Result<Response, String> {
    let rate: u32 = header(&request, "x-rate")
        .and_then(|r| r.parse().ok())
        .unwrap_or(48_000);
    if !(8_000..=48_000).contains(&rate) {
        return Err("The sound's rate is outside what the encoder takes.".into());
    }
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("The export sent something that is not sound.".into());
    };
    if !bytes.len().is_multiple_of(8) {
        return Err("The sound is not whole stereo samples.".into());
    }
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    let (left, right) = samples.split_at(samples.len() / 2);
    Ok(Response::new(mp3(left, right, rate)?))
}

#[cfg(test)]
#[path = "encode_tests.rs"]
mod tests;
