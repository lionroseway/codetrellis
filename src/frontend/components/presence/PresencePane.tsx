/**
 * Agent Presence Pane — floating overlay for agent narration.
 *
 * Renders a draggable, dismissable pane with a stack of narration cards
 * posted by MCP agents. Supports TTS via the built-in Web Speech API
 * and two-way dialogue via a reply input box.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Minus, Check, Volume2, Send, MessageSquare, ChevronUp } from 'lucide-react';
import { usePresenceStore } from '../../stores/presence-store';
import type { PresenceCard } from '@shared/types';

// --- Markdown-lite renderer ---

function renderCardText(text: string): React.ReactNode[] {
  // Split on **bold**, `code`, and [text](url) — keep it minimal
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  const regex = /(\*\*(.+?)\*\*)|(`([^`]+?)`)|(\[([^\]]+?)\]\(([^)]+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(remaining)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{remaining.slice(lastIndex, match.index)}</span>);
    }
    if (match[2]) {
      // Bold
      parts.push(<strong key={key++} className="font-semibold text-foreground">{match[2]}</strong>);
    } else if (match[4]) {
      // Inline code
      parts.push(<code key={key++} className="font-mono text-[11px] bg-white/[0.06] px-1 py-0.5 rounded">{match[4]}</code>);
    } else if (match[6] && match[7]) {
      // Link
      parts.push(
        <a key={key++} href={match[7]} target="_blank" rel="noreferrer"
          className="text-accent hover:underline">{match[6]}</a>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < remaining.length) {
    parts.push(<span key={key++}>{remaining.slice(lastIndex)}</span>);
  }
  return parts.length > 0 ? parts : [<span key={0}>{text}</span>];
}

/** Strip markdown for TTS — remove **, `, and [text](url) → text */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+?)`/g, '$1')
    .replace(/\[([^\]]+?)\]\([^)]+?\)/g, '$1');
}

// --- Tone styles ---

const TONE_BORDER: Record<string, string> = {
  neutral: 'border-l-accent/40',
  success: 'border-l-green-500/40',
  warning: 'border-l-amber-500/40',
  question: 'border-l-purple-400/40',
};

const TONE_ICON_COLOR: Record<string, string> = {
  neutral: 'text-accent/60',
  success: 'text-green-400/60',
  warning: 'text-amber-400/60',
  question: 'text-purple-400/60',
};

// --- TTS ---

let cachedVoice: SpeechSynthesisVoice | null = null;

function getPreferredVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = speechSynthesis.getVoices();
  // Prefer an English voice
  cachedVoice = voices.find((v) => v.lang.startsWith('en') && v.localService) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    voices[0] ?? null;
  return cachedVoice;
}

// --- Component ---

export function PresencePane() {
  const cards = usePresenceStore((s) => s.cards);
  const visible = usePresenceStore((s) => s.visible);
  const minimized = usePresenceStore((s) => s.minimized);
  const position = usePresenceStore((s) => s.position);
  const inputPrompt = usePresenceStore((s) => s.inputPrompt);
  const setVisible = usePresenceStore((s) => s.setVisible);
  const setMinimized = usePresenceStore((s) => s.setMinimized);
  const setPosition = usePresenceStore((s) => s.setPosition);
  const ackCard = usePresenceStore((s) => s.ackCard);

  const [speakingCardId, setSpeakingCardId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  const unreadCount = cards.filter((c) => c.requireAck && !c.acked).length;

  // Auto-scroll to bottom on new card
  useEffect(() => {
    if (scrollRef.current && !minimized) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [cards.length, minimized]);

  // Speak cards with speak=true when they arrive
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const lastCard = cards[cards.length - 1];
    if (!lastCard || !lastCard.speak || lastCard.acked) return;

    // Don't re-speak cards we already processed
    const spokenKey = `spoken-${lastCard.id}`;
    if ((window as any)[spokenKey]) return;
    (window as any)[spokenKey] = true;

    const text = stripMarkdown(lastCard.text);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    const voice = getPreferredVoice();
    if (voice) utterance.voice = voice;

    setSpeakingCardId(lastCard.id);

    utterance.onend = () => {
      setSpeakingCardId(null);
      if (lastCard.requireAck && !lastCard.acked) {
        handleAck(lastCard.id, 'speech-end');
      }
    };
    utterance.onerror = () => {
      setSpeakingCardId(null);
    };

    speechSynthesis.speak(utterance);
  }, [cards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Populate voices (some browsers load them async)
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.onvoiceschanged = () => {
      cachedVoice = null;
      getPreferredVoice();
    };
  }, []);

  const handleAck = useCallback(async (cardId: string, via: 'click' | 'speech-end') => {
    ackCard(cardId, via);
    try {
      await fetch('/api/presence/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, via }),
      });
    } catch {
      // best-effort
    }
  }, [ackCard]);

  const handleReply = useCallback(async () => {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    setReplyText('');
    try {
      await fetch('/api/presence/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch {
      // best-effort
    } finally {
      setSending(false);
    }
  }, [replyText, sending]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleReply();
    }
  }, [handleReply]);

  // --- Drag ---

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = paneRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
    };
    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [setPosition]);

  if (!visible || cards.length === 0) return null;

  const posStyle = position
    ? { left: position.x, top: position.y, right: 'auto' as const, bottom: 'auto' as const }
    : { bottom: 80, left: 16 };

  return (
    <div
      ref={paneRef}
      className="fixed z-[9998] flex flex-col"
      style={{ width: 340, maxHeight: minimized ? undefined : 440, ...posStyle }}
    >
      {/* Header — draggable */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-2 px-3 py-2 rounded-t-xl bg-[#0d1117] border border-white/[0.1] border-b-0 cursor-grab active:cursor-grabbing select-none"
      >
        <MessageSquare size={13} className="text-accent shrink-0" />
        <span className="text-[12px] font-medium text-foreground flex-1">
          Agent
        </span>
        {unreadCount > 0 && (
          <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-medium">
            {unreadCount}
          </span>
        )}
        <span className="text-[10px] text-foreground-muted">
          {cards.length} card{cards.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => setMinimized(!minimized)}
          className="text-foreground-muted hover:text-foreground transition-colors p-0.5"
          title={minimized ? 'Expand' : 'Minimize'}
        >
          {minimized ? <ChevronUp size={12} /> : <Minus size={12} />}
        </button>
        <button
          onClick={() => setVisible(false)}
          className="text-foreground-muted hover:text-foreground transition-colors p-0.5"
          title="Close"
        >
          <X size={12} />
        </button>
      </div>

      {/* Body */}
      {!minimized && (
        <div className="flex flex-col bg-[#0d1117]/95 backdrop-blur-xl border border-white/[0.1] border-t-0 rounded-b-xl overflow-hidden">
          {/* Card stack */}
          <div
            ref={scrollRef}
            className="flex flex-col gap-1.5 p-2.5 overflow-y-auto"
            style={{ maxHeight: 320 }}
          >
            {cards.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                isSpeaking={speakingCardId === card.id}
                onAck={handleAck}
              />
            ))}
          </div>

          {/* Reply input */}
          <div className="flex items-center gap-1.5 px-2.5 py-2 border-t border-white/[0.06]">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={inputPrompt || 'Reply to agent...'}
              className="flex-1 text-[12px] bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-accent/40"
            />
            <button
              onClick={handleReply}
              disabled={!replyText.trim() || sending}
              className="shrink-0 p-1.5 rounded-md text-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Send reply"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Card row ---

function CardRow({
  card,
  isSpeaking,
  onAck,
}: {
  card: PresenceCard;
  isSpeaking: boolean;
  onAck: (cardId: string, via: 'click' | 'speech-end') => void;
}) {
  const borderClass = TONE_BORDER[card.tone] || TONE_BORDER.neutral;
  const iconColor = TONE_ICON_COLOR[card.tone] || TONE_ICON_COLOR.neutral;

  return (
    <div
      className={`relative border-l-2 ${borderClass} pl-2.5 pr-2 py-1.5 rounded-r-md transition-opacity ${
        card.acked ? 'opacity-55' : ''
      }`}
    >
      {/* Agent label */}
      {card.agentId && (
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`text-[10px] ${iconColor} font-medium`}>
            {card.agentId}
          </span>
          {isSpeaking && (
            <Volume2 size={10} className="text-accent animate-pulse" />
          )}
        </div>
      )}
      {!card.agentId && isSpeaking && (
        <div className="mb-0.5">
          <Volume2 size={10} className="text-accent animate-pulse" />
        </div>
      )}

      {/* Card body */}
      <div className="text-[12px] text-foreground-muted leading-relaxed">
        {renderCardText(card.text)}
      </div>

      {/* Ack button or checkmark */}
      <div className="flex items-center gap-2 mt-1">
        {card.requireAck && !card.acked && (
          <button
            onClick={() => onAck(card.id, 'click')}
            className="flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            <Check size={10} />
            Got it
          </button>
        )}
        {card.acked && (
          <span className="flex items-center gap-1 text-[10px] text-foreground-muted/40">
            <Check size={9} />
            {card.ackedVia === 'speech-end' ? 'heard' : 'read'}
          </span>
        )}
        {isSpeaking && (
          <span className="text-[10px] text-accent/60 animate-pulse">
            speaking...
          </span>
        )}
      </div>
    </div>
  );
}
