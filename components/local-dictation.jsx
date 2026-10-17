"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { useLocale } from "./locale-provider";
import { useTerminalText } from "./terminal/context";
export default function LocalDictation({ onText, disabled }) {
  const { locale } = useLocale(),
    text = useTerminalText(),
    recognition = useRef(null),
    epoch = useRef(0);
  const [listening, setListening] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const generation = epoch;
    const stop = () => {
      epoch.current++;
      recognition.current?.abort();
      recognition.current = null;
      setListening(false);
    };
    window.addEventListener("blur", stop);
    return () => {
      generation.current++;
      recognition.current?.abort();
      window.removeEventListener("blur", stop);
    };
  }, []);
  async function start() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    setMessage("");
    const token = ++epoch.current;
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (
      !Speech ||
      !("processLocally" in Speech.prototype) ||
      !Speech.available
    ) {
      setMessage(
        text(
          "Local dictation is unavailable in this browser. You can type or paste a task.",
          "当前浏览器不支持本地语音识别，可输入或粘贴任务。",
        ),
      );
      return;
    }
    try {
      const lang = locale === "zh" ? "zh-CN" : "en-US";
      const ready = await Speech.available({
        langs: [lang],
        processLocally: true,
      });
      if (token !== epoch.current) return;
      if (ready !== "available") {
        setMessage(
          text(
            "A local language pack is not ready. Type or paste instead; no audio is sent to a remote service.",
            "本地语言包未就绪，请输入或粘贴；不会向远程服务发送音频。",
          ),
        );
        return;
      }
      const r = new Speech();
      r.lang = lang;
      r.processLocally = true;
      r.interimResults = false;
      recognition.current = r;
      r.onresult = (e) => {
        if (token === epoch.current) onText(e.results[0][0].transcript);
      };
      r.onend = () => {
        if (token === epoch.current) setListening(false);
      };
      r.onerror = () => {
        if (token === epoch.current) {
          setListening(false);
          setMessage(
            text(
              "Local recognition stopped. Check microphone permission or type the task.",
              "本地识别已停止，请检查麦克风权限或输入任务。",
            ),
          );
        }
      };
      r.start();
      setListening(true);
    } catch {
      if (token !== epoch.current) return;
      setMessage(
        text(
          "Local recognition could not start. Type or paste your task.",
          "本地语音无法启动，请输入或粘贴任务。",
        ),
      );
    }
  }
  return (
    <div className="local-dictation">
      <button
        type="button"
        className="text-button"
        disabled={disabled}
        aria-pressed={listening}
        onClick={start}
      >
        {listening ? <Square size={14} /> : <Mic size={14} />}{" "}
        {listening
          ? text("Stop dictation", "停止听写")
          : text("Local dictation", "本地听写")}
      </button>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
