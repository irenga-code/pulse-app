import { api } from '@/lib/apiClient';

/** WhatsApp's "Export chat": download up to 1000 messages (after any "Clear chat" moment) as a plain text file. */
export async function exportChat(conversationId: string, name: string, me: string | undefined, clearedAt: string | null | undefined) {
  const rows = await api.listMessages(conversationId, 1000);
  const lines = rows.filter((m) => !clearedAt || m.created_at > clearedAt).map((m) => {
    const who = m.kind === 'system' ? 'Pulse' : m.sender_id === me ? 'You' : name;
    const media = m.media_type === 'audio' ? ' [voice message]' : m.media_url ? ` [${m.media_type}: ${m.media_url}]` : '';
    return `[${new Date(m.created_at).toLocaleString()}] ${who}: ${m.body}${media}`;
  });
  const blob = new Blob([`Pulse chat with ${name}\n\n${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Pulse chat with ${name.replace(/[^\w\- ]+/g, '')}.txt`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
