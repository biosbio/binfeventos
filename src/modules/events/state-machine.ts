import type { EventStatus } from "@prisma/client";

// ============================================================
// Módulo events — máquina de estados (documento mestre, Domínio 2).
// Transições validadas SEMPRE no servidor; o cliente nunca decide estado.
// ============================================================

export const EVENT_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  DRAFT: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["SUSPENDED", "SOLD_OUT", "POSTPONED", "CANCELLED", "COMPLETED"],
  SUSPENDED: ["PUBLISHED", "CANCELLED"],
  SOLD_OUT: ["PUBLISHED"], // inventário libertado manualmente
  POSTPONED: ["PUBLISHED", "CANCELLED"],
  CANCELLED: [],  // terminal
  COMPLETED: [],  // terminal
  CLOSED: [],     // terminal
};

export const TERMINAL_STATUSES: readonly EventStatus[] = ["CANCELLED", "COMPLETED", "CLOSED"];

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return EVENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionLabel(status: EventStatus): string {
  switch (status) {
    case "DRAFT": return "Em preparação";
    case "PUBLISHED": return "Publicado";
    case "SUSPENDED": return "Suspenso";
    case "SOLD_OUT": return "Esgotado";
    case "POSTPONED": return "Adiado";
    case "CANCELLED": return "Cancelado";
    case "COMPLETED": return "Concluído";
    case "CLOSED": return "Encerrado";
  }
}
