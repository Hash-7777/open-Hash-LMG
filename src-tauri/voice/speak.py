# Speaks one line of narration with a voice installed on this computer, for
# Hash LMG. Run by the app with the interpreter of the person's own install;
# reads its request as JSON on standard input and writes a 48 kHz mono WAV to
# the path the app gives it. Nothing is downloaded by this script beyond what
# the voice itself fetches on its first use.
import json
import os
import sys
import wave

import numpy as np

spec = json.loads(sys.stdin.read())
engine, folder, out = spec["engine"], spec["folder"], spec["out"]
text = spec["text"]
speed = float(spec.get("speed", 1.0))


def write(samples, rate):
    s = np.asarray(samples, dtype=np.float32).reshape(-1)
    if rate != 48000:
        n = int(round(len(s) * 48000 / rate))
        s = np.interp(np.arange(n) * rate / 48000, np.arange(len(s)), s)
    pcm = (np.clip(s, -1, 1) * 32767).astype("<i2")
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(pcm.tobytes())


if engine == "kokoro":
    from kokoro_onnx import Kokoro

    k = Kokoro(os.path.join(folder, "kokoro-v1.0.onnx"), os.path.join(folder, "voices-v1.0.bin"))
    samples, rate = k.create(text, voice=spec.get("voice") or "af_heart", speed=speed, lang="en-us")
    write(samples, rate)
elif engine == "chatterbox":
    import torch
    from chatterbox.tts import ChatterboxTTS

    want = spec.get("device", "auto")
    if want == "cpu" or not (torch.cuda.is_available() or torch.backends.mps.is_available()):
        device = "cpu"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "mps" if want == "gpu" else "cpu"
    model = ChatterboxTTS.from_pretrained(device=device)
    wav = model.generate(text)
    write(wav.squeeze().detach().cpu().numpy(), model.sr)
else:
    sys.exit(f"unknown voice {engine}")
