import type { Decision, EventoDetalle, EventoResumen, Usuario } from "./tipos";

async function pedir<T>(url: string, opciones?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...opciones?.headers },
  });
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    throw new Error(typeof cuerpo.detail === "string" ? cuerpo.detail : `Error ${r.status}`);
  }
  return r.json();
}

export const api = {
  usuarios: () => pedir<Usuario[]>("/api/usuarios"),
  eventos: (estado?: string) =>
    pedir<EventoResumen[]>(`/api/eventos${estado ? `?estado=${estado}` : ""}`),
  evento: (id: string) => pedir<EventoDetalle>(`/api/eventos/${id}`),
  revisar: (id: string, revisor_id: number, decision: Decision, placa_final: string, comentario: string) =>
    pedir<{ estado: string }>(`/api/eventos/${id}/revision`, {
      method: "POST",
      body: JSON.stringify({
        revisor_id, decision,
        placa_final: placa_final || null,
        comentario: comentario || null,
      }),
    }),
  urlEvidencia: (id: number) => `/api/evidencias/${id}/archivo`,
};
