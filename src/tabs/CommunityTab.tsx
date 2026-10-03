import { useState } from 'react';
import { Send, UserCheck, MessageSquare, Sliders, CheckCircle } from 'lucide-react';

interface Post {
  id: string;
  author: string;
  venue: string;
  role: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  timestamp: string;
}

export function CommunityTab() {
  const [roleMode, setRoleMode] = useState<'guest' | 'host' | 'mc'>('guest');
  const [customName, setCustomName] = useState('African Simba');
  const [customVenue, setCustomVenue] = useState('Nomad (Bunga)');
  const [isSettingUp, setIsSettingUp] = useState(false);
  
  const [postContent, setPostContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');

  const [posts, setPosts] = useState<Post[]>([
    {
      id: '1',
      author: 'African Simba',
      venue: 'Nomad',
      role: 'Verified Host',
      content: 'Swift Friday at Nomad is officially underway! The energy along Ggaba Road is unmatched tonight. Pull through for the ultimate weekend kickoff! 🔥',
      mediaUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
      mediaType: 'image',
      timestamp: '15 mins ago'
    },
    {
      id: '2',
      author: 'Partyman',
      venue: 'Nomad',
      role: 'Official MC',
      content: 'You already know how we do it! Swift Friday at Nomad is moving crazy right now. Microphones are hot, the crowd is wild—let us make this a movie tonight! 🎤✨',
      mediaUrl: 'https://images.unsplash.com/photo-1543007630-9710e4a00a20?auto=format&fit=crop&w=800&q=80',
      mediaType: 'image',
      timestamp: '45 mins ago'
    }
  ]);

  const handleCreatePost = (e: React.FormEvent) => {
    e.preventDefault();

    let authorName = 'Guest User';
    let roleTitle = 'Community Member';
    if (roleMode === 'host') {
      authorName = customName;
      roleTitle = 'Verified Host';
    } else if (roleMode === 'mc') {
      authorName = customName;
      roleTitle = 'Official MC';
    }

    const newPost: Post = {
      id: Date.now().toString(),
      author: authorName,
      venue: customVenue,
      role: roleTitle,
      content: postContent,
      mediaUrl: mediaUrl.trim() || undefined,
      mediaType: mediaUrl.trim() ? mediaType : undefined,
      timestamp: 'Just now'
    };

    setPosts([newPost, ...posts]);
    setPostContent('');
    setMediaUrl('');
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto p-4 pb-12">
      {/* Account Setup & Role Selector */}
      <div className="bg-[#12181b] border border-white/10 rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm">Account & Posting Profile</h4>
              <p className="text-xs text-gray-400">
                {roleMode === 'guest' ? 'Posting as a regular guest' : `Posting as ${customName} (${roleMode.toUpperCase()})`}
              </p>
            </div>
          </div>
          <button
            className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition"
          >
            {isSettingUp ? 'Close Setup' : 'Configure Account'}
          </button>
        </div>

        {isSettingUp && (
          <div className="pt-3 border-t border-white/10 grid grid-cols-1 md:grid-cols-3 gap-3 animate-in fade-in duration-200">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-400 mb-1">Active Role</label>
              <select
                value={roleMode}
                onChange={(e) => setRoleMode(e.target.value as 'guest' | 'host' | 'mc')}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="guest">Guest / Standard User</option>
                <option value="host">Venue Host</option>
                <option value="mc">Event MC</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-400 mb-1">Display Name</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                disabled={roleMode === 'guest'}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-400 mb-1">Venue / Location</label>
              <input
                type="text"
                value={customVenue}
                onChange={(e) => setCustomVenue(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Post Creator (Unlocked for everyone to simulate natural engagement) */}
      <form onSubmit={handleCreatePost} className="bg-[#161d22] border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <UserCheck className="w-4 h-4" /> Share to Community
          </span>
          <span className="text-xs text-gray-400">{customVenue}</span>
        </div>

        <textarea
          value={postContent}
          onChange={(e) => setPostContent(e.target.value)}
          placeholder={roleMode === 'host' ? "Announce Swift Friday updates, tables, or guest lists..." : "What's happening on the strip tonight? Share a moment..."}
          rows={3}
          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-emerald-500 transition resize-none"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            type="text"
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="Paste photo or video URL (optional)..."
            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
          />
          <div className="flex items-center gap-2 justify-end">
            <select
              value={mediaType}
              onChange={(e) => setMediaType(e.target.value as 'image' | 'video')}
              className="bg-black/40 border border-white/10 text-xs text-gray-300 rounded-xl px-3 py-2 focus:outline-none"
            >
              <option value="image">Photo</option>
              <option value="video">Video</option>
            </select>
            <button
              type="submit"
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition shadow-lg"
            >
              <Send className="w-3.5 h-3.5" /> Post
            </button>
          </div>
        </div>
      </form>

      {/* Community Feed without like numbers */}
      <div className="space-y-4">
        {posts.map((post) => (
          <div key={post.id} className="bg-[#12181b] border border-white/5 rounded-2xl p-5 space-y-3 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-sm">
                  {post.author.charAt(0)}
                </div>
                <div>
                  <h4 className="text-white font-medium text-sm flex items-center gap-2">
                    {post.author}
                    {post.role !== 'Community Member' && (
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-normal flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> {post.role}
                      </span>
                    )}
                  </h4>
                  <p className="text-xs text-gray-400">{post.venue} • {post.timestamp}</p>
                </div>
              </div>
            </div>

            <p className="text-gray-200 text-sm leading-relaxed">{post.content}</p>

            {post.mediaUrl && (
              <div className="rounded-xl overflow-hidden border border-white/10 max-h-80 bg-black flex items-center justify-center">
                <img src={post.mediaUrl} alt="Community upload" className="w-full h-full object-cover" />
              </div>
            )}

            <div className="flex items-center gap-6 pt-2 text-xs text-gray-400 border-t border-white/5">
              <button className="hover:text-emerald-400 transition">Reply</button>
              <button className="hover:text-emerald-400 transition">Share</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default CommunityTab;
