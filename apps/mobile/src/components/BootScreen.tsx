import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAudio } from "../hooks/useAudio";

interface BootScreenProps {
  onComplete: () => void;
}

const BOOT_LINES = [
  "VAULT-TEC INDUSTRIES (R) TERMLINK PROTOCOL",
  "CALLOUT RIFF-BOY v0.1.0",
  "",
  "COPYRIGHT 2077 VAULT-TEC INDUSTRIES",
  "",
  "INITIALIZING SYSTEM...",
  "LOADING INCIDENT PROTOCOLS...",
  "CONNECTING TO VAULT NETWORK...",
  "BIOMETRIC SCANNER READY...",
  "",
  "SYSTEM READY",
];

export default function BootScreen({ onComplete }: BootScreenProps) {
  const [currentLine, setCurrentLine] = useState(0);
  const [displayedText, setDisplayedText] = useState<string[]>([]);
  const [charIndex, setCharIndex] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const [bootComplete, setBootComplete] = useState(false);

  const { initialize, playBootSound, isInitialized } = useAudio();
  const lastBeepCharRef = useRef(0);
  const lastLineRef = useRef(-1);

  // Cursor blink effect
  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 500);
    return () => clearInterval(cursorInterval);
  }, []);

  // Play terminal beeps during typing (every ~5 characters)
  useEffect(() => {
    if (!isInitialized) return;
    if (charIndex > 0 && charIndex - lastBeepCharRef.current >= 5) {
      playBootSound("beep");
      lastBeepCharRef.current = charIndex;
    }
  }, [charIndex, isInitialized, playBootSound]);

  // Play line complete sound when a line finishes
  useEffect(() => {
    if (!isInitialized) return;
    if (currentLine > lastLineRef.current && currentLine > 0 && currentLine < BOOT_LINES.length) {
      playBootSound("line_complete");
      lastLineRef.current = currentLine;
    }
  }, [currentLine, isInitialized, playBootSound]);

  // Typewriter effect
  useEffect(() => {
    if (currentLine >= BOOT_LINES.length) {
      // Play system ready fanfare
      if (isInitialized) {
        playBootSound("system_ready");
      }
      setTimeout(() => {
        setBootComplete(true);
        setTimeout(onComplete, 250);
      }, 150);
      return;
    }

    const line = BOOT_LINES[currentLine];

    if (line === "") {
      // Empty line - just add it and move on
      setDisplayedText((prev) => [...prev, ""]);
      setCurrentLine((prev) => prev + 1);
      setCharIndex(0);
      return;
    }

    if (charIndex < line.length) {
      const timeout = setTimeout(() => {
        setDisplayedText((prev) => {
          const newText = [...prev];
          if (newText.length <= currentLine) {
            newText.push(line.charAt(charIndex));
          } else {
            newText[currentLine] = newText[currentLine] + line.charAt(charIndex);
          }
          return newText;
        });
        setCharIndex((prev) => prev + 1);
      }, 7 + Math.random() * 10); // Slightly random typing speed

      return () => clearTimeout(timeout);
    } else {
      // Line complete, move to next
      const timeout = setTimeout(() => {
        setCurrentLine((prev) => prev + 1);
        setCharIndex(0);
      }, 33);
      return () => clearTimeout(timeout);
    }
  }, [currentLine, charIndex, onComplete]);

  return (
    <AnimatePresence>
      {!bootComplete && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed top-0 left-0 right-0 bottom-0 z-50 bg-zinc-900 flex flex-col items-center justify-center p-6 crt-effect"
          style={{ width: "100vw", height: "100dvh", minHeight: "100vh" }}
        >
          {/* Decorative border */}
          <div className="absolute inset-4 border-2 border-amber-500/30 rounded-lg pointer-events-none" />

          {/* Corner decorations */}
          <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-amber-500 rounded-tl-lg" />
          <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-amber-500 rounded-tr-lg" />
          <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-amber-500 rounded-bl-lg" />
          <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-amber-500 rounded-br-lg" />

          {/* RIFF-BOY Logo */}
          <div className="text-amber-500 font-mono text-center mb-6 leading-none whitespace-pre text-glow" style={{ fontSize: '8px', letterSpacing: '1px' }}>
{`██████╗ ██╗███████╗███████╗    ██████╗  ██████╗ ██╗   ██╗
██╔══██╗██║██╔════╝██╔════╝    ██╔══██╗██╔═══██╗╚██╗ ██╔╝
██████╔╝██║█████╗  █████╗█████╗██████╔╝██║   ██║ ╚████╔╝
██╔══██╗██║██╔══╝  ██╔══╝╚════╝██╔══██╗██║   ██║  ╚██╔╝
██║  ██║██║██║     ██║         ██████╔╝╚██████╔╝   ██║
╚═╝  ╚═╝╚═╝╚═╝     ╚═╝         ╚═════╝  ╚═════╝    ╚═╝`}
          </div>

          {/* Boot text - all lines pre-rendered for stable layout */}
          <div className="font-mono text-sm w-full max-w-md text-left pl-8">
            {BOOT_LINES.map((_, i) => {
              const typedText = displayedText[i] ?? "";
              const isCurrentLine = i === currentLine;
              const isTyped = i < currentLine || (i === currentLine && typedText.length > 0);

              return (
                <div
                  key={i}
                  className={`h-6 leading-6 ${
                    typedText.includes("SYSTEM READY")
                      ? "text-green-500 font-bold text-glow-green"
                      : typedText.includes("RIFF-BOY")
                      ? "text-amber-500 font-bold text-glow"
                      : "text-amber-500/80"
                  }`}
                >
                  {typedText}
                  {isCurrentLine && isTyped && showCursor && (
                    <span className="text-amber-500">█</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Loading bar - fixed to bottom */}
          <div className="absolute bottom-16 left-8 right-8">
            <div className="h-2 bg-zinc-800 border border-amber-500/30 rounded overflow-hidden">
              <motion.div
                className="h-full bg-amber-500"
                initial={{ width: 0 }}
                animate={{ width: `${(currentLine / BOOT_LINES.length) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            {/* Hint - changes based on audio state */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ delay: 0.3 }}
              className={`text-xs font-mono text-center mt-3 ${isInitialized ? "text-amber-500/40" : "text-amber-500"}`}
            >
              {isInitialized ? "TAP TO SKIP" : "TAP TO ENABLE AUDIO"}
            </motion.p>
          </div>

          {/* Tap overlay - first tap enables audio, second tap skips */}
          <div
            className="absolute inset-0"
            onClick={async () => {
              if (!isInitialized) {
                // First tap: initialize audio, boot continues with sounds
                await initialize();
              } else {
                // Second tap: skip boot
                setBootComplete(true);
                onComplete();
              }
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
