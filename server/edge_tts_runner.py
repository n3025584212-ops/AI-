"""Edge neural TTS runner: JSON {text, voice, rate} on stdin -> {ok, pcmBase64} on stdout.

Produces 16 kHz mono 16-bit PCM so server/voice.mjs can wrap it exactly like the
SAPI engine's output. Any failure exits with {ok:false} so the caller falls back
to the offline SAPI engine.
"""
from __future__ import annotations
import array, base64, json, sys, asyncio

for _name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    import os
    os.environ.setdefault(_name, "1")

def main() -> None:
    try:
        request = json.loads(sys.stdin.read())
        text = str(request.get("text", "")).strip()
        voice = str(request.get("voice", "zh-CN-XiaoxiaoNeural"))
        rate = str(request.get("rate", "+8%"))
        if not text:
            raise ValueError("empty text")
        import edge_tts, miniaudio

        async def synth() -> bytes:
            communicate = edge_tts.Communicate(text, voice, rate=rate)
            chunks = [chunk["data"] async for chunk in communicate.stream() if chunk["type"] == "audio"]
            return b"".join(chunks)

        mp3 = asyncio.run(synth())
        decoded = miniaudio.decode(mp3, nchannels=1, sample_rate=16000, output_format=miniaudio.SampleFormat.SIGNED16)
        pcm = array.array("h", decoded.samples).tobytes()
        if not pcm:
            raise ValueError("empty audio")
        json.dump({"ok": True, "pcmBase64": base64.b64encode(pcm).decode("ascii")}, sys.stdout)
    except Exception:
        import traceback
        traceback.print_exc(file=sys.stderr)
        json.dump({"ok": False, "code": "edge_unavailable"}, sys.stdout)

if __name__ == "__main__":
    main()
