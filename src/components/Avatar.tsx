const colors = ['bg-wa-green', 'bg-blue-500', 'bg-orange-500', 'bg-pink-500', 'bg-purple-500', 'bg-teal-600'];

function initials(name: string | null | undefined) {
  name = name ?? '';
  const parts = name.replace(/[_.-]+/g, ' ').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function hash(s: string | null | undefined) {
  s = s ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default function Avatar({ name: rawName, url, size = 40 }: { name?: string | null; url?: string | null; size?: number }) {
  // rows from older data can arrive without an author name
  const name = rawName?.trim() || 'Anonymous';
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.34) };
  if (url) {
    return <img src={url} alt="" style={style} className="rounded-full object-cover flex-shrink-0" loading="lazy" />;
  }
  return (
    <div
      style={style}
      className={`rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 ${colors[hash(name) % colors.length]}`}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}
