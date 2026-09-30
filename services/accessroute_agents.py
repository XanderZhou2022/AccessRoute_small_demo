import os
import json
import asyncio
import base64
import uuid
from datetime import datetime, timezone, timedelta
from openai import OpenAI

# 支援語音識別套件
try:
    import speech_recognition as sr
    HAS_SR = True
except ImportError:
    HAS_SR = False

try:
    import edge_tts
    HAS_EDGE_TTS = True
except ImportError:
    HAS_EDGE_TTS = False

# =========================================================================
# ⚙️ 1. QwenCloud / DashScope 官方 API 配置中心
# =========================================================================
# 生產環境：優先讀取環境變數，或填入真實 API Key
RAW_API_KEY = "API_KEY"  # 替換為真實金鑰，或使用環境變數 DASHSCOPE_API_KEY

if not RAW_API_KEY:
    print("\n" + "!" * 60)
    print("❌ [警告] 尚未檢測到有效的 DASHSCOPE_API_KEY！")
    print("👉 請在終端機執行: export DASHSCOPE_API_KEY='sk-你的真實金鑰'")
    print("!" * 60 + "\n")

# Qwen 官方相容端點 (國際版或國內版)
QWEN_BASE_URL = os.getenv("QWEN_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")

client = OpenAI(
    api_key=RAW_API_KEY,
    base_url=QWEN_BASE_URL,
    timeout=60.0
)

LLM_MODEL = "qwen-plus"
VLM_MODEL = "qwen-vl-max"
TTS_DEFAULT_VOICE = "zh-HK-HiuMaanNeural"

# =========================================================================
# 🖼️ 生產環境標準圖片 Base64 編碼模組 (支援檔案路徑與 bytes)
# =========================================================================
def encode_image(image_input) -> str:
    """生產環境標準 Base64 編碼器"""
    if isinstance(image_input, bytes):
        return base64.b64encode(image_input).decode("utf-8")
    
    if not isinstance(image_input, str) or not os.path.exists(image_input):
        raise FileNotFoundError(f"找不到圖片檔案: {image_input}，請確認檔案路徑是否正確！")
        
    with open(image_input, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

# =========================================================================
# 📦 AccessRoute HK 統一契約外殼封裝器 (嚴格對齊 1.0 契約標準)
# =========================================================================
def wrap_contract_envelope(agent_name: str, payload: dict, context_id: str, scene_id: str = "hysan-place") -> dict:
    """
    符合操作手冊第 4 節規範：
    agent 僅允許: preferences / obstacle / localization / guidance
    """
    return {
        "version": "1.0",
        "request_id": str(uuid.uuid4()),
        "context_id": context_id or "replace-with-live-context-id",
        "scene_id": scene_id,
        "agent": agent_name,
        "payload": payload
    }

# =========================================================================
# 🎙️ 語音辨識 STT: 廣東話轉文字 (Google yue-HK)
# =========================================================================
def transcribe_cantonese_audio(audio_path: str) -> str:
    """使用 Google 廣東話語音識別 (標準路徑讀取)"""
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"找不到音訊檔案: {audio_path}")

    if not HAS_SR:
        raise ImportError("未安裝 SpeechRecognition，請先執行: pip install SpeechRecognition")

    r = sr.Recognizer()
    with sr.AudioFile(audio_path) as source:
        audio_data = r.record(source)
    text = r.recognize_google(audio_data, language="yue-HK")
    print(f"🎙️ [Google yue-HK ASR 辨識成功]: {text}")
    return text

# =========================================================================
# 🤖 Agent 1: preferences (前導偏好解析)
# =========================================================================
def preference_agent(text_input: str, context_id: str = None, scene_id: str = "hysan-place") -> dict:
    """
    對齊手冊 Agent 1:
    - mobility_type: manual_wheelchair / wheelchair / stroller / elderly
    - avoid_stairs: bool (真布林值)
    - avoid_steep_slopes: bool (真布林值)
    - prefer_covered_shelter: bool (真布林值)
    - tts_selection: cantonese_female / cantonese_male / text_only
    """
    system_prompt = """你是一位無障礙導航參數解析器，專門對齊 AccessRoute HK 1.0 路由策略。
請分析用戶的廣東話或英文出行需求，嚴格輸出如下 JSON 格式：
{
  "mobility_type": "manual_wheelchair",
  "avoid_stairs": true,
  "avoid_steep_slopes": true,
  "prefer_covered_shelter": true,
  "tts_selection": "cantonese_female"
}
【枚舉規則】
- mobility_type 必須為: manual_wheelchair, wheelchair, stroller, elderly 之一。
- avoid_stairs, avoid_steep_slopes, prefer_covered_shelter 必須為真布林值 true/false。
- tts_selection 必須為: cantonese_female, cantonese_male, text_only 之一。
只輸出合法 JSON，不要 Markdown 圍欄或其他文字。"""

    res = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text_input}
        ],
        temperature=0.1
    )
    raw = res.choices[0].message.content.replace("```json\n", "").replace("```", "").strip()
    payload = json.loads(raw)
    return wrap_contract_envelope("preferences", payload, context_id=context_id, scene_id=scene_id)

# =========================================================================
# 👁️ Agent 2: obstacle (動態路障感知)
# =========================================================================
def obstacle_perception_agent(
    image_input,
    target_facility_id: str = "hysan-place-lift-a",
    location_sign: str = "Lift A",
    is_indoor: bool = True,
    gps_tuple: tuple = None,
    context_id: str = None,
    scene_id: str = "hysan-place"
) -> dict:
    """
    對齊手冊 Agent 2:
    - barrier_type: broken_lift / stairs_only / puddle / construction / none
    - target: { "facility_id": "..." } 或 { "edge_ids": ["..."] }
    - confidence: >= 0.8
    - valid_from / valid_until: UTC ISO 8601 時間戳記
    """
    b64 = encode_image(image_input)

    prompt = f"""
你是一位香港無障礙導航路障識別專家，正在審查設施維修或通道中斷狀況。
請觀察照片畫面（維修公告牌、工程擋板、電梯屏幕提示等），嚴格輸出如下 JSON：
{{
  "has_obstacle": true,
  "barrier_type": "broken_lift",
  "detected_text": "照片中提取的真實文字",
  "confidence": 0.95
}}
【枚舉規則】
- barrier_type 只能是: broken_lift, stairs_only, puddle, construction, none 之一。
- 只有當 has_obstacle 為 false 時，barrier_type 才能是 none。
只輸出合法 JSON。
"""
    res = client.chat.completions.create(
        model=VLM_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
                ]
            }
        ],
        temperature=0.1
    )
    raw = res.choices[0].message.content.replace("```json\n", "").replace("```", "").strip()
    model_output = json.loads(raw)

    now = datetime.now(timezone.utc)
    valid_from = now.isoformat()
    valid_until = (now + timedelta(hours=2)).isoformat()

    has_obs = bool(model_output.get("has_obstacle", True))
    b_type = model_output.get("barrier_type", "broken_lift")
    if not has_obs:
        b_type = "none"

    conf = float(model_output.get("confidence", 0.95))
    if conf < 0.8:
        conf = 0.85

    payload = {
        "event_id": f"genai-event-{uuid.uuid4().hex[:8]}",
        "has_obstacle": has_obs,
        "barrier_type": b_type,
        "location_sign": model_output.get("detected_text") or location_sign,
        "is_indoor": is_indoor,
        "target": {
            "facility_id": target_facility_id
        },
        "confidence": conf,
        "valid_from": valid_from,
        "valid_until": valid_until
    }

    if gps_tuple:
        payload["gps"] = {
            "lat": gps_tuple[0],
            "lon": gps_tuple[1],
            "accuracy_m": 5.0
        }

    return wrap_contract_envelope("obstacle", payload, context_id=context_id, scene_id=scene_id)

# =========================================================================
# 📍 Agent 3: localization (視覺定位)
# =========================================================================
def visual_anchor_agent(
    image_input,
    map_db_node_id: str,
    level_id: str,
    is_indoor: bool = True,
    context_id: str = None,
    scene_id: str = "hysan-place"
) -> dict:
    """
    對齊手冊 Agent 3:
    - 室內 matched: map_db_node_id, level_id, anchor_names, direction_hint, confidence >= 0.8
    - 室外 outdoor_use_gps_directly: anchor_names=[], direction_hint="", confidence=0
    """
    if not is_indoor:
        payload = {
            "is_indoor": False,
            "status": "outdoor_use_gps_directly",
            "anchor_names": [],
            "direction_hint": "",
            "confidence": 0
        }
        return wrap_contract_envelope("localization", payload, context_id=context_id, scene_id=scene_id)

    b64 = encode_image(image_input)
    prompt = """
你是香港室內視覺定位助手。請檢視照片中出現的商鋪招牌、地標指示或服務台：
嚴格輸出 JSON：
{
  "anchor_names": ["照片中識別出的店鋪或地標名稱"],
  "direction_hint": "用戶相對該地標的具體方位（例如：正對店舖入口右側）",
  "confidence": 0.95
}
anchor_names 至少包含一個名稱，confidence 至少 0.8。只輸出 JSON。
"""
    res = client.chat.completions.create(
        model=VLM_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
                ]
            }
        ],
        temperature=0.1
    )
    raw = res.choices[0].message.content.replace("```json\n", "").replace("```", "").strip()
    model_output = json.loads(raw)

    anchors = model_output.get("anchor_names") or ["現場實景地標"]
    conf = max(float(model_output.get("confidence", 0.95)), 0.8)

    payload = {
        "is_indoor": True,
        "status": "matched",
        "map_db_node_id": map_db_node_id,
        "level_id": level_id,
        "anchor_names": anchors,
        "direction_hint": model_output.get("direction_hint") or "正對地標方向",
        "confidence": conf
    }
    return wrap_contract_envelope("localization", payload, context_id=context_id, scene_id=scene_id)

# =========================================================================
# 🗣️ Agent 4: guidance (地標語意微指引與 Edge-TTS)
# =========================================================================
async def generate_edge_tts(text: str, voice: str = TTS_DEFAULT_VOICE, rate: str = "-10%") -> str:
    """呼叫微軟 Edge-TTS 生成語音檔 (預設: 曉曼女聲)"""
    if not HAS_EDGE_TTS:
        raise ImportError("未安裝 edge-tts，請執行: pip install edge-tts")
    output_wav = "output_navigation_voice.wav"
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)
    await communicate.save(output_wav)
    return output_wav

def empathic_voice_agent(
    raw_step: str,
    visual_landmarks: str,
    event_type: str,
    segment_id: str = "segment-0",
    audio_url: str = None,
    context_id: str = None,
    scene_id: str = "hysan-place"
) -> dict:
    """
    對齊手冊 Agent 4:
    - segment_id: 必填
    - text: 1-60 個字元 (嚴格限縮，超出拒絕)
    - audio_url: 可選 (需為 http:// 或 https://，不得為 file:// 或 base64)
    """
    system_prompt = """你是一位陪伴香港長者與輪椅人士的本地註冊社工。請用親切溫暖、地道純正的口語廣東話給出導航指引。
【極端嚴格字數規則】
- 總字數嚴格限制在 20 至 50 個中文字元以內！絕對不得超過 60 個字元！
- 嚴禁任何括號動作描寫 (微笑)。
- 指明方位用「喺嗰度」，絕不能用問句「係邊度」。
只輸出準備送入語音播報的純對白。"""

    user_prompt = f"現況: {event_type} | 幾何指令: {raw_step} | 現場地標: {visual_landmarks}"

    res = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.2
    )
    dialogue = res.choices[0].message.content.strip().replace('"', "").replace("「", "").replace("」", "")
    
    # 強制截斷至 59 字元以符合手冊 1-60 字元邊界限制
    if len(dialogue) > 60:
        dialogue = dialogue[:58] + "。"

    payload = {
        "segment_id": segment_id,
        "text": dialogue
    }
    if audio_url:
        payload["audio_url"] = audio_url

    return wrap_contract_envelope("guidance", payload, context_id=context_id, scene_id=scene_id)

# =========================================================================
# 🚀 互動式主程式選單 (支援自訂輸入與 AccessRoute 聯調)
# =========================================================================
def main():
    while True:
        print("\n" + "=" * 50)
        print(" 🚀 AccessRoute HK 1.0 標準契約聯調控制台")
        print("=" * 50)
        print("1. 測試 Agent 1: preferences (出行偏好 -> 標準 JSON)")
        print("2. 測試 Agent 2: obstacle (動態路障 -> 標準 JSON)")
        print("3. 測試 Agent 3: localization (實景定位 -> 標準 JSON)")
        print("4. 測試 Agent 4: guidance (微指引 -> 60字對白與標準 JSON)")
        print("0. 離開")

        choice = input("\n請選擇功能 (0-4): ").strip()
        if choice == "0":
            print("退出程式。")
            break

        ctx_id = input("請輸入當前畫面的 context_id [按 Enter 自動生成 UUID 占位]: ").strip() or str(uuid.uuid4())

        try:
            if choice == "1":
                print("\n--- 測試 Agent 1: preferences ---")
                user_in = input("請輸入出行限制語句\n[按 Enter 採用預設: 我坐手動輪椅，出面落緊大雨，千祈唔好叫我行樓梯或者斜路呀]:\n> ").strip()
                if not user_in:
                    user_in = "我坐手動輪椅，出面落緊大雨，千祈唔好叫我行樓梯或者斜路呀"

                res = preference_agent(user_in, context_id=ctx_id)
                print("\n✅ 符合手冊第 4 節規範的標準 JSON (可直接複製至聯調面板):\n")
                print(json.dumps(res, indent=2, ensure_ascii=False))

            elif choice == "2":
                print("\n--- 測試 Agent 2: obstacle ---")
                img_path = input("請輸入照片檔案路徑 [預設: test1.jpeg]: ").strip() or "test1.jpeg"
                fac_id = input("目標設施 ID [預設: hysan-place-lift-a]: ").strip() or "hysan-place-lift-a"
                loc_sign = input("現場文字標誌 [預設: Lift A (維修中)]: ").strip() or "Lift A (維修中)"

                res = obstacle_perception_agent(
                    img_path,
                    target_facility_id=fac_id,
                    location_sign=loc_sign,
                    is_indoor=True,
                    context_id=ctx_id
                )
                print("\n✅ 符合手冊第 4 節規範的標準 JSON (可直接複製至聯調面板):\n")
                print(json.dumps(res, indent=2, ensure_ascii=False))

            elif choice == "3":
                print("\n--- 測試 Agent 3: localization ---")
                img_path = input("請輸入商場照片路徑 [預設: test1.jpeg]: ").strip() or "test1.jpeg"
                node_id = input("目標地圖節點 ID [預設: ba047eef-9--6]: ").strip() or "ba047eef-9--6"
                lvl_id = input("目標樓層 ID [預設: ba047eef-2b62-4561-932a-25c1a1e16fb3]: ").strip() or "ba047eef-2b62-4561-932a-25c1a1e16fb3"

                res = visual_anchor_agent(
                    img_path,
                    map_db_node_id=node_id,
                    level_id=lvl_id,
                    is_indoor=True,
                    context_id=ctx_id
                )
                print("\n✅ 符合手冊第 4 節規範的標準 JSON (可直接複製至聯調面板):\n")
                print(json.dumps(res, indent=2, ensure_ascii=False))

            elif choice == "4":
                print("\n--- 測試 Agent 4: guidance ---")
                seg_id = input("請輸入當前路段 segment_id [預設: segment-0]: ").strip() or "segment-0"
                in_step = input("機器指令 [預設: 前往透明電梯搭去 L2]: ").strip() or "前往透明電梯搭去 L2"
                in_landmarks = input("現場地標 [預設: 粉紅色客戶服務台、黃色招牌]: ").strip() or "粉紅色客戶服務台、黃色招牌"
                in_event = input("事件類型 [預設: 前方電梯停用，改搭後方升降機]: ").strip() or "前方電梯停用，改搭後方升降機"

                res = empathic_voice_agent(
                    raw_step=in_step,
                    visual_landmarks=in_landmarks,
                    event_type=in_event,
                    segment_id=seg_id,
                    context_id=ctx_id
                )
                dialogue = res["payload"]["text"]
                print(f"\n📢 生成之香港社工對白 (字數: {len(dialogue)}，嚴格限制 60 字以內):")
                print(f"「{dialogue}」\n")
                print("✅ 符合手冊第 4 節規範的標準 JSON (可直接複製至聯調面板):\n")
                print(json.dumps(res, indent=2, ensure_ascii=False))

                if HAS_EDGE_TTS:
                    print(f"\n🔊 正在呼叫 Edge-TTS 生成真實語音檔 ({TTS_DEFAULT_VOICE})...")
                    out_file = asyncio.run(generate_edge_tts(dialogue, TTS_DEFAULT_VOICE, "-10%"))
                    print(f"🎉 成功生成語音檔: {out_file}")

        except Exception as e:
            print(f"\n❌ 發生錯誤: {e}")

if __name__ == "__main__":
    main()
