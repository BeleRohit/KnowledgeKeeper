"""
KnowledgeKeeper — local transcript server
Run once: pip install -r requirements.txt
Then:      python server.py
Listens on http://localhost:5005
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
from youtube_transcript_api import (
    YouTubeTranscriptApi,
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
)

app = Flask(__name__)
CORS(app)  # allow requests from the chrome-extension:// origin


@app.route("/transcript")
def get_transcript():
    video_id = request.args.get("videoId", "").strip()
    if not video_id:
        return jsonify({"error": "videoId parameter is required"}), 400

    try:
        # Prefer English; fall back to whatever is available (incl. auto-generated)
        try:
            entries = YouTubeTranscriptApi.get_transcript(
                video_id, languages=["en", "en-US", "en-GB"]
            )
        except NoTranscriptFound:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            # try auto-generated English first, then any language
            try:
                entries = transcript_list.find_generated_transcript(["en"]).fetch()
            except Exception:
                entries = next(iter(transcript_list)).fetch()

        text = " ".join(e["text"].replace("\n", " ").strip() for e in entries)
        return jsonify({"transcript": text, "segments": len(entries)})

    except TranscriptsDisabled:
        return jsonify({"error": "Transcripts are disabled for this video."}), 404
    except NoTranscriptFound:
        return jsonify({"error": "No transcript found for this video."}), 404
    except VideoUnavailable:
        return jsonify({"error": "Video is unavailable."}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5005))
    app.run(host="0.0.0.0", port=port)
