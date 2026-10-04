"""Command-line entry point for the four backend workflows.

The former combined Qwen script is replaced by the shared backend implementation.
Export the current workflow context from the browser's assistant panel to context.json.
"""
import argparse
import base64
import json
import mimetypes
from pathlib import Path
from accessroute_api import AccessRouteAPI


def main():
    parser = argparse.ArgumentParser(description="AccessRoute workflow client")
    parser.add_argument("workflow", choices=["preferences", "obstacle", "localization", "guidance"])
    parser.add_argument("--context", required=True, help="JSON file exported from the current page")
    parser.add_argument("--text")
    parser.add_argument("--image")
    parser.add_argument("--level-id")
    parser.add_argument("--base-url", default="http://127.0.0.1:8787")
    args = parser.parse_args()
    context = json.loads(Path(args.context).read_text(encoding="utf-8"))
    inputs = {}
    if args.workflow == "preferences":
        if not args.text:
            parser.error("preferences requires --text")
        inputs["text"] = args.text
    elif args.workflow in ["obstacle", "localization"]:
        if not args.image:
            parser.error("photo workflows require --image")
        path = Path(args.image)
        mime = mimetypes.guess_type(path.name)[0]
        if mime not in ["image/jpeg", "image/png", "image/webp"]:
            parser.error("image must be JPEG, PNG or WebP")
        inputs["image"] = f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")
        if args.level_id:
            inputs["level_id"] = args.level_id
    result = AccessRouteAPI(args.base_url).run(args.workflow, context, **inputs)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
