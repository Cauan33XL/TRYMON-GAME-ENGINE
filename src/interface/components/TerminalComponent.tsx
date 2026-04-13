/**
 * Terminal Component with xterm.js integration
 * Provides a real terminal interface connected to the v86 emulator or shell
 */

import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalProps {
  onInput: (data: string) => void;
  output?: string;
  isRunning: boolean;
  className?: string;
}

export function TerminalComponent({ onInput, output, isRunning, className }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const outputRef = useRef<string>('');
  const isWritingRef = useRef(false);

  useEffect(() => {
    if (!terminalRef.current || initializedRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#00f2ff',
        cursorAccent: '#0a0a0c',
        selectionBackground: '#0070f340',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#ffa657',
        blue: '#79c0ff',
        magenta: '#d2a8ff',
        cyan: '#00f2ff',
        white: '#c9d1d9',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#aff5b4',
        brightYellow: '#ffd477',
        brightBlue: '#a5d6ff',
        brightMagenta: '#e2a5ff',
        brightCyan: '#76e3ff',
        brightWhite: '#f0f6fc'
      },
      allowProposedApi: true,
      scrollback: 10000,
      tabStopWidth: 8,
      fontWeight: '400',
      fontWeightBold: '700'
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);

    setTimeout(() => {
      fitAddon.fit();
      term.focus();
    }, 100);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    initializedRef.current = true;

    term.onData(data => {
      onInput(data);
    });

    term.onResize(() => {
      fitAddon.fit();
    });

    return () => {
      term.dispose();
      initializedRef.current = false;
    };
  }, [onInput]);

  useEffect(() => {
    if (!termRef.current || !output) return;

    if (isWritingRef.current) return;
    
    const currentOutput = outputRef.current;
    if (output.startsWith(currentOutput)) {
      const newText = output.slice(currentOutput.length);
      if (newText) {
        isWritingRef.current = true;
        termRef.current.write(newText);
        outputRef.current = output;
        setTimeout(() => {
          isWritingRef.current = false;
        }, 10);
      }
    } else if (output !== currentOutput) {
      termRef.current.write('\x1b[2J\x1b[H');
      termRef.current.write(output);
      outputRef.current = output;
    }
  }, [output]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.cursorBlink = isRunning;
  }, [isRunning]);

  useEffect(() => {
    const handleResize = () => {
      fitAddonRef.current?.fit();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  return (
    <div
      ref={terminalRef}
      className={className}
      onClick={focus}
      style={{ 
        width: '100%', 
        height: '100%',
        outline: 'none'
      }}
      tabIndex={0}
    />
  );
}