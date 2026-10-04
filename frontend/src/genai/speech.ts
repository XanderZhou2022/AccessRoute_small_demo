import type { SpeechPlan } from '../../../shared/genai/workflows';
export function speak(text: string, plan: SpeechPlan): Promise<void> {
  if (plan.selection === 'text_only') return Promise.resolve();
  if (!('speechSynthesis' in window)) return Promise.reject(new Error('此瀏覽器未提供語音播報'));
  const synth = window.speechSynthesis;
  return new Promise((resolve, reject) => {
    const start = () => {
      const voices = synth.getVoices();
      const cantonese = voices.filter((v) => /^(zh-HK|yue)/i.test(v.lang));
      if (!cantonese.length) {
        reject(new Error('裝置未安裝粵語語音，請在系統語音設定加入香港中文'));
        return;
      }
      const preferred =
        plan.selection === 'cantonese_male'
          ? /(?<!fe)male|wanlung|danny|男/i
          : /female|sinji|hiumaan|女/i;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = cantonese.find((v) => preferred.test(v.name)) || cantonese[0];
      utterance.lang = plan.language;
      utterance.rate = 0.9;
      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(new Error(`語音播放失敗：${e.error}`));
      synth.cancel();
      synth.speak(utterance);
    };
    if (synth.getVoices().length) start();
    else {
      const timer = window.setTimeout(() => {
        synth.removeEventListener('voiceschanged', loaded);
        start();
      }, 1500);
      function loaded() {
        window.clearTimeout(timer);
        synth.removeEventListener('voiceschanged', loaded);
        start();
      }
      synth.addEventListener('voiceschanged', loaded);
    }
  });
}
