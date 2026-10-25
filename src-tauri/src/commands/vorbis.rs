// Vorbis, the sound of a WebM film, encoded by Xiph's own encoder built into
// the app from source.
//
// The encoder writes an Ogg stream; WebM wants the bare packets, so the pages
// are read back into packets here. A WebM file also times every packet, and
// Ogg times only the ends of its pages, so each packet's start is worked out
// from the two block sizes the stream declares: a packet of a long or short
// block gives back a quarter of the block before it and a quarter of its own.
//
// The answer, all numbers little end first:
//   [4 bytes: length][the three headers, as WebM's codec description]
//   then per packet [4 bytes: length][8 bytes: its first sample][the packet]

use std::num::{NonZeroU32, NonZeroU8};

use tauri::ipc::{InvokeBody, Request, Response};
use vorbis_rs::{VorbisBitrateManagementStrategy, VorbisEncoderBuilder};

/// Stereo sound as Ogg Vorbis, from the two channels one after the other.
pub fn ogg(left: &[f32], right: &[f32], rate: u32) -> Result<Vec<u8>, String> {
    let rate = NonZeroU32::new(rate).ok_or("The sound has no rate.")?;
    let mut builder = VorbisEncoderBuilder::new_with_serial(rate, NonZeroU8::new(2).unwrap(), Vec::new(), 1);
    // Quality 0.6 of 1: about 192 kilobits a second for stereo, like the MP3.
    builder.bitrate_management_strategy(VorbisBitrateManagementStrategy::QualityVbr { target_quality: 0.6 });
    let mut enc = builder.build().map_err(|e| format!("The sound encoder could not start: {e}"))?;
    for (l, r) in left.chunks(1024).zip(right.chunks(1024)) {
        enc.encode_audio_block([l, r]).map_err(|e| format!("The sound encoder failed: {e}"))?;
    }
    enc.finish().map_err(|e| format!("The sound could not be finished: {e}"))
}

/// The packets of a single Ogg stream, and the last page's sample position.
pub fn ogg_packets(mut b: &[u8]) -> Result<(Vec<Vec<u8>>, u64), String> {
    let mut packets = Vec::new();
    let mut part: Vec<u8> = Vec::new();
    let mut granule = 0u64;
    while !b.is_empty() {
        if b.len() < 27 || &b[..4] != b"OggS" {
            return Err("The sound encoder wrote a stream that could not be read.".into());
        }
        granule = u64::from_le_bytes(b[6..14].try_into().unwrap());
        let n = b[26] as usize;
        let table = b.get(27..27 + n).ok_or("A page of sound is cut short.")?;
        let mut at = 27 + n;
        for &len in table {
            let len = len as usize;
            part.extend_from_slice(b.get(at..at + len).ok_or("A page of sound is cut short.")?);
            at += len;
            if len < 255 {
                packets.push(std::mem::take(&mut part));
            }
        }
        b = &b[at..];
    }
    Ok((packets, granule))
}

/// Where each audio packet's sound starts, in samples, from the block sizes
/// of the identification header. The encoder's streams have two modes, short
/// blocks then long, so one bit after the packet type names the block.
pub fn packet_starts(ident: &[u8], audio: &[Vec<u8>]) -> Result<Vec<u64>, String> {
    let sizes = ident.get(28).ok_or("The sound's first header is cut short.")?;
    let (short, long) = (1u64 << (sizes & 0x0f), 1u64 << (sizes >> 4));
    let mut starts = Vec::with_capacity(audio.len());
    let mut t = 0u64;
    let mut prev: Option<u64> = None;
    for p in audio {
        let block = if p.first().is_some_and(|b| b & 2 != 0) { long } else { short };
        if let Some(pb) = prev {
            t += pb / 4 + block / 4;
        }
        starts.push(t);
        prev = Some(block);
    }
    Ok(starts)
}

/// The three headers laced as WebM describes Vorbis: their count less one,
/// the first two lengths in runs of 255, then the headers end to end.
pub fn codec_private(headers: &[Vec<u8>]) -> Vec<u8> {
    let mut out = vec![2u8];
    for h in &headers[..2] {
        let mut n = h.len();
        while n >= 255 {
            out.push(255);
            n -= 255;
        }
        out.push(n as u8);
    }
    for h in headers {
        out.extend_from_slice(h);
    }
    out
}

pub fn webm_sound(left: &[f32], right: &[f32], rate: u32) -> Result<Vec<u8>, String> {
    let (packets, _) = ogg_packets(&ogg(left, right, rate)?)?;
    if packets.len() < 3 {
        return Err("The sound encoder wrote no headers.".into());
    }
    let (headers, audio) = packets.split_at(3);
    let starts = packet_starts(&headers[0], audio)?;
    let cp = codec_private(headers);
    let mut out = Vec::with_capacity(cp.len() + audio.iter().map(|p| p.len() + 12).sum::<usize>() + 4);
    out.extend_from_slice(&(cp.len() as u32).to_le_bytes());
    out.extend_from_slice(&cp);
    for (p, s) in audio.iter().zip(starts) {
        out.extend_from_slice(&(p.len() as u32).to_le_bytes());
        out.extend_from_slice(&s.to_le_bytes());
        out.extend_from_slice(p);
    }
    Ok(out)
}

#[tauri::command]
pub fn vorbis_encode(request: Request<'_>) -> Result<Response, String> {
    let rate: u32 = request
        .headers()
        .get("x-rate")
        .and_then(|v| v.to_str().ok())
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
    Ok(Response::new(webm_sound(left, right, rate)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(n: usize) -> Vec<f32> {
        (0..n).map(|i| ((i as f32) * 0.03).sin() * 0.3 + ((i as f32) * 0.0007).sin() * 0.2).collect()
    }

    #[test]
    fn packets_read_back_from_the_pages_with_the_three_headers_first() {
        let left = tone(48_000 * 2);
        let (packets, granule) = ogg_packets(&ogg(&left, &left, 48_000).unwrap()).unwrap();
        assert_eq!(&packets[0][..7], b"\x01vorbis");
        assert_eq!(&packets[1][..7], b"\x03vorbis");
        assert_eq!(&packets[2][..7], b"\x05vorbis");
        assert!(packets.len() > 20);
        assert_eq!(granule, 96_000);
    }

    #[test]
    fn packet_starts_add_up_to_the_stream_length() {
        let left = tone(48_000 * 3 + 517);
        let (packets, granule) = ogg_packets(&ogg(&left, &left, 48_000).unwrap()).unwrap();
        let starts = packet_starts(&packets[0], &packets[3..]).unwrap();
        assert!(starts.windows(2).all(|w| w[1] > w[0]), "each packet starts after the one before");
        let long = 1u64 << (packets[0][28] >> 4);
        let last = *starts.last().unwrap();
        // The encoder pads its last block, and the last page's position trims
        // that padding away, so the last start is within a block of the end
        // on either side.
        assert!(last.abs_diff(granule) <= long, "the last packet starts within a block of the end");
    }

    #[test]
    fn the_codec_description_laces_the_headers() {
        let h = vec![vec![1u8; 30], vec![3u8; 300], vec![5u8; 10]];
        let cp = codec_private(&h);
        assert_eq!(&cp[..4], &[2, 30, 255, 45]);
        assert_eq!(cp.len(), 4 + 340);
    }

    #[test]
    fn the_answer_is_framed_as_described() {
        let left = tone(24_000);
        let out = webm_sound(&left, &left, 48_000).unwrap();
        let cp = u32::from_le_bytes(out[..4].try_into().unwrap()) as usize;
        let mut b = &out[4 + cp..];
        let mut n = 0;
        while !b.is_empty() {
            let len = u32::from_le_bytes(b[..4].try_into().unwrap()) as usize;
            b = &b[12 + len..];
            n += 1;
        }
        assert!(n > 5);
    }
}
