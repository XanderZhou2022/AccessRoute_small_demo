"""HTTP client only: no model prompts, map matching, or workflow logic."""
import json
from urllib.request import Request, urlopen


class AccessRouteAPI:
    def __init__(self, base_url="http://127.0.0.1:8787"):
        self.base_url = base_url.rstrip("/")

    def post(self, path, body):
        request = Request(
            self.base_url + path,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=150) as response:
            return json.load(response)

    def run(self, workflow, context, **inputs):
        return self.post(f"/api/genai/workflows/{workflow}", {"context": context, **inputs})

    def confirm(self, confirmation_id, candidate_id, context):
        return self.post("/api/genai/confirm", {
            "confirmation_id": confirmation_id, "candidate_id": candidate_id, "context": context,
        })
