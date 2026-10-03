import { useState } from 'react';
import { Bell, Settings as SettingsIcon, Bookmark, ChevronRight, X } from 'lucide-react';

export function ProfileTab() {
  const [activeModal, setActiveModal] = useState<'notifications' | 'settings' | 'saved' | null>(null);
  const [pushNotif, setPushNotif] = useState(true);
  const [emailDigest, setEmailDigest] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  return (
    <div className="space-y-4 max-w-2xl mx-auto p-4">
      <div
        onClick={() => setActiveModal('notifications')}
        className="bg-[#12181b] border border-white/5 hover:border-white/15 transition rounded-xl p-4 flex items-center justify-between cursor-pointer shadow-lg"
      >
        <div className="flex items-center gap-3">
          <Bell className="w-5 h-5 text-emerald-400" />
          <span className="text-white font-medium">Notifications</span>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-500" />
      </div>

      <div
        onClick={() => setActiveModal('settings')}
        className="bg-[#12181b] border border-white/5 hover:border-white/15 transition rounded-xl p-4 flex items-center justify-between cursor-pointer shadow-lg"
      >
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-5 h-5 text-emerald-400" />
          <span className="text-white font-medium">Settings</span>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-500" />
      </div>

      <div
        onClick={() => setActiveModal('saved')}
        className="bg-[#12181b] border border-white/5 hover:border-white/15 transition rounded-xl p-4 flex items-center justify-between cursor-pointer shadow-lg"
      >
        <div className="flex items-center gap-3">
          <Bookmark className="w-5 h-5 text-emerald-400" />
          <span className="text-white font-medium">Saved venues</span>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-500" />
      </div>

      {activeModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#161d22] border border-white/10 rounded-2xl w-full max-w-md p-6 relative shadow-2xl">
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg bg-white/5 hover:bg-white/10 transition"
            >
              <X className="w-5 h-5" />
            </button>

            {activeModal === 'notifications' && (
              <div>
                <h3 className="text-lg font-bold text-white mb-4">Notifications</h3>
                <div className="space-y-3 text-sm text-gray-300">
                  <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                    <p className="font-medium text-white">Vanquish opened VIP bookings</p>
                    <span className="text-xs text-gray-400">2 hours ago</span>
                  </div>
                  <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                    <p className="font-medium text-white">New event added at Guvnor</p>
                    <span className="text-xs text-gray-400">Yesterday</span>
                  </div>
                </div>
              </div>
            )}

            {activeModal === 'settings' && (
              <div>
                <h3 className="text-lg font-bold text-white mb-4">App Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Push Notifications</span>
                    <input
                      type="checkbox"
                      checked={pushNotif}
                      className="accent-emerald-500 w-4 h-4 cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Email Digest</span>
                    <input
                      type="checkbox"
                      checked={emailDigest}
                      className="accent-emerald-500 w-4 h-4 cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Dark Mode</span>
                    <input
                      type="checkbox"
                      checked={darkMode}
                      className="accent-emerald-500 w-4 h-4 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeModal === 'saved' && (
              <div>
                <h3 className="text-lg font-bold text-white mb-4">Saved Venues</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                    <div>
                      <h4 className="font-medium text-white text-sm">Paradigm</h4>
                      <span className="text-xs text-gray-400">Ggaba Road, Kansanga</span>
                    </div>
                    <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full font-medium">Live</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                    <div>
                      <h4 className="font-medium text-white text-sm">Nomad</h4>
                      <span className="text-xs text-gray-400">Ggaba Road, Bunga</span>
                    </div>
                    <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full font-medium">Live</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProfileTab;
