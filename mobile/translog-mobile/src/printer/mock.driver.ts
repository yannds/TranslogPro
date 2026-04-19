/**
 * MockPrinterDriver — imprime en console (utilisable Expo Go, CI, tests).
 * Simule la mise en file et les erreurs matérielles pour que l'UI soit
 * testable sans imprimante physique.
 */

import type { PrinterDriver, PrinterStatus, ReceiptPayload } from './printer.types';

// Pas de magic number dans la logique métier.
const CONNECT_DELAY_MS = 200;
const PRINT_DELAY_MS   = 300;

export class MockPrinterDriver implements PrinterDriver {
  private connected = false;

  async getStatus(): Promise<PrinterStatus> {
    return { connected: this.connected, name: this.connected ? 'MOCK-58MM-DEV' : undefined };
  }

  async connect(): Promise<PrinterStatus> {
    await sleep(CONNECT_DELAY_MS);
    this.connected = true;
    return this.getStatus();
  }

  async print(payload: ReceiptPayload): Promise<void> {
    if (!this.connected) {
      // Comportement : le driver doit lever si pas connecté — caller (outbox)
      // rejouera quand le printer sera connecté.
      throw new Error('PRINTER_NOT_CONNECTED');
    }
    await sleep(PRINT_DELAY_MS);
    // Log formaté pour aider le dev à inspecter le rendu en temps réel.
    const rendered = renderReceiptAsText(payload);
    // eslint-disable-next-line no-console
    console.log(`[MockPrinter] job=${payload.id} kind=${payload.kind}\n${rendered}`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function renderReceiptAsText(payload: ReceiptPayload): string {
  const pad = payload.width;
  const lines: string[] = [];
  lines.push('─'.repeat(pad));
  for (const l of payload.lines) {
    if (l.divider) { lines.push('─'.repeat(pad)); continue; }
    const t = l.text ?? '';
    switch (l.align) {
      case 'center': lines.push(center(t, pad)); break;
      case 'right':  lines.push(right(t, pad));  break;
      default:       lines.push(t);
    }
  }
  if (payload.qr) lines.push(`[QR] ${payload.qr.slice(0, 24)}…`);
  lines.push('─'.repeat(pad));
  return lines.join('\n');
}

function center(s: string, width: number): string {
  const extra = Math.max(0, width - s.length);
  const left = Math.floor(extra / 2);
  return ' '.repeat(left) + s;
}

function right(s: string, width: number): string {
  return ' '.repeat(Math.max(0, width - s.length)) + s;
}
