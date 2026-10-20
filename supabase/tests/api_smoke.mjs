// End-to-end check of src/lib/api.ts against the real schema + RLS.
//
// It needs PostgREST in front of a database with migrations 1-3 applied (see
// supabase/tests/run_api_smoke.sh, which wires everything up locally). The test
// signs its own JWTs, so it exercises the exact REST calls the app makes,
// including Row Level Security and column privileges.
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { createApi } from '../../src/lib/api.ts';

const { PGRST_PROXY = 'http://127.0.0.1:3001', JWT_SECRET = 'pulse-local-test-secret-0123456789abcdef' } = process.env;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload) => {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${head}.${crypto.createHmac('sha256', JWT_SECRET).update(head).digest('base64url')}`;
};
const ANON = sign({ role: 'anon' });
const clientFor = (uid) =>
  createClient(PGRST_PROXY, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${uid ? sign({ sub: uid, role: 'authenticated' }) : ANON}` } },
  });

const U = {
  alice: 'a0000000-0000-0000-0000-000000000001',
  bob: 'a0000000-0000-0000-0000-000000000002',
  mgr: 'a0000000-0000-0000-0000-000000000003',
  adm: 'a0000000-0000-0000-0000-000000000004',
  carol: 'a0000000-0000-0000-0000-000000000005',
};
const anon = createApi(clientFor(null));
const alice = createApi(clientFor(U.alice));
const bob = createApi(clientFor(U.bob));
const mgr = createApi(clientFor(U.mgr));
const adm = createApi(clientFor(U.adm));
const carol = createApi(clientFor(U.carol));

let passed = 0;
const ok = (cond, label) => {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`ok - ${label}`);
};
const rejects = async (fn, label, match) => {
  try {
    await fn();
  } catch (e) {
    if (match && !match.test(e.message)) throw new Error(`FAIL: ${label} (unexpected error: ${e.message})`);
    passed++;
    console.log(`ok - blocked: ${label} (${e.message.slice(0, 70)})`);
    return e;
  }
  throw new Error(`FAIL: expected an error: ${label}`);
};

// ---- anonymous
const venues = await anon.listVenues();
ok(venues.length === 8, 'anon reads the 8 confirmed venues from venues_public');
ok(venues.find((v) => v.name === 'Taboo')?.location === 'Bugolobi', 'Taboo shows Bugolobi');
ok(venues.every((v) => ['live', 'sold_out', 'not_active'].includes(v.status)), 'only the new status vocabulary is returned');
const nomad = venues.find((v) => v.name === 'Nomad');
const thrones = venues.find((v) => v.name === 'Thrones');
ok((await anon.listPosts()).length === 0, 'anon can read the (empty) feed');
await rejects(() => anon.createPost({ content: 'anon post' }), 'anon cannot post');
await rejects(() => anon.saveVenue(nomad.id), 'anon cannot save venues');
await rejects(() => anon.followVenue(nomad.id), 'anon cannot follow venues');
ok((await anon.listNotifications()).every((n) => n.type === 'system' || n.type === 'community' || n.type === 'venue_live'), 'anon sees broadcast notifications only');

// ---- posting, comments, reactions
const p1 = await alice.createPost({ content: '  Nomad is packed tonight  ' });
ok(p1.user_name === 'alice_k' && p1.content === 'Nomad is packed tonight' && !p1.is_official, 'post created; author stamped by DB');
const p2 = await alice.createPost({ content: 'Outside Nomad', venue_id: nomad.id });
ok(p2.venue_name === 'Nomad' && p2.is_official === false, 'venue tag set by DB; user post is not official');
const pm = await mgr.createPost({ content: 'Doors open at 9pm', venue_id: nomad.id });
ok(pm.is_official === true, 'verified venue manager post is Official');
ok((await bob.listPosts()).length === 3, 'feed lists visible posts');
const prof = await bob.profilesByIds((await bob.listPosts()).map((p) => p.user_id));
ok(prof[U.alice]?.display_name === 'alice_k' && !('email' in prof[U.alice]), 'author profiles are public and contain no email');

const c1 = await bob.addComment(p1.id, ' Count me in ');
ok(c1.body === 'Count me in' && c1.user_name === 'bob_b', 'comment created; author stamped');
ok((await anon.listComments(p1.id)).length === 1, 'anon can read comments');
await rejects(() => anon.addComment(p1.id, 'x'), 'anon cannot comment');
await rejects(() => bob.addComment(p1.id, 'x'.repeat(501)), 'comment length limit');
ok((await alice.listPosts()).find((p) => p.id === p1.id).comments === 1, 'comment counter updated');

let mine = await bob.setReaction(p1.id, U.bob, 'fire', null);
ok(mine === 'fire', 'react with fire');
mine = await bob.setReaction(p1.id, U.bob, 'heart', mine);
ok(mine === 'heart', 'switch reaction to heart');
await alice.setReaction(p1.id, U.alice, 'party', null);
let counts = await anon.reactionCounts([p1.id]);
ok(counts[p1.id].heart === 1 && counts[p1.id].party === 1 && !counts[p1.id].fire, 'reaction counts per emoji');
ok((await bob.myReactions(U.bob, [p1.id]))[p1.id] === 'heart', 'my reaction is returned');
mine = await bob.setReaction(p1.id, U.bob, 'heart', mine);
ok(mine === null, 'tapping the same emoji removes the reaction');
ok((await alice.listPosts()).find((p) => p.id === p1.id).likes === 1, 'likes counter follows reactions');
await rejects(() => anon.setReaction(p1.id, U.alice, 'fire', null), 'anon cannot react');

// ---- reports (user side)
await bob.createReport({ target_type: 'post', target_id: p2.id, reason: 'spam', details: 'looks like an ad' });
const dup = await rejects(() => bob.createReport({ target_type: 'post', target_id: p2.id, reason: 'spam' }), 'duplicate report');
ok(dup.code === '23505', 'duplicate report has unique-violation code');
await alice.createReport({ target_type: 'comment', target_id: c1.id, reason: 'harassment' });
await rejects(() => anon.createReport({ target_type: 'post', target_id: p1.id, reason: 'spam' }), 'anon cannot report');

// ---- follows / saved
await alice.followVenue(nomad.id);
ok((await alice.listVenueFollows(U.alice)).includes(nomad.id), 'follow venue');
ok((await bob.listVenueFollows(U.bob)).length === 0, 'follows are private');
await alice.unfollowVenue(U.alice, nomad.id);
ok((await alice.listVenueFollows(U.alice)).length === 0, 'unfollow venue');
await alice.saveVenue(thrones.id);
ok((await alice.listSaved(U.alice))[0].venue_id === thrones.id, 'save venue');
await rejects(() => alice.saveVenue(thrones.id), 'duplicate save', /duplicate|unique|already/i);
await alice.unsaveVenue(U.alice, thrones.id);
ok((await alice.listSaved(U.alice)).length === 0, 'unsave venue');

// ---- profile & preferences
ok((await alice.getProfile(U.alice)).display_name === 'alice_k', 'own profile');
const up = await alice.updateProfile(U.alice, { bio: 'Kampala nights' });
ok(up.bio === 'Kampala nights', 'edit bio');
await rejects(() => alice.updateProfile(U.alice, { display_name: 'me@mail.com' }), 'email as display name');
await rejects(() => alice.updateProfile(U.alice, { display_name: 'bob_b' }), 'duplicate display name');
await rejects(() => alice.updateProfile(U.alice, { account_type: 'venue' }), 'cannot self-promote');
ok(await alice.isDisplayNameTaken('BOB_B'), 'display name availability is case-insensitive');
ok(!(await alice.isDisplayNameTaken('brand_new_name')), 'free name is available');
ok(!(await alice.isDisplayNameTaken('alice_k', U.alice)), 'own name is not "taken" for me');
ok(!(await alice.isDisplayNameTaken('%')), 'wildcards are escaped');
await alice.savePreferences(U.alice, { theme: 'light', live_venue_alerts: false });
const prefs = await alice.getPreferences(U.alice);
ok(prefs.theme === 'light' && prefs.live_venue_alerts === false && prefs.community_alerts === true, 'preferences saved and read back');
ok((await bob.getPreferences(U.alice)) === null, 'preferences are private');
ok((await alice.isAdmin(U.alice)) === false && (await adm.isAdmin(U.adm)) === true, 'admin check');

// ---- notifications
const notes = await alice.listNotifications();
ok(notes.some((n) => n.type === 'comment') && notes.some((n) => n.type === 'reaction'), 'alice sees comment + reaction notifications');
ok(!notes.some((n) => n.title.includes('bob_b started')), 'no unrelated notifications');
await alice.markNotificationRead(notes[0].id);
await alice.markNotificationRead(notes[0].id); // idempotent
let reads = await alice.listReadNotificationIds(U.alice);
ok(reads.length === 1, 'mark one read (idempotent)');
await alice.markAllNotificationsRead();
reads = await alice.listReadNotificationIds(U.alice);
ok(reads.length === (await alice.listNotifications()).length, 'mark all read');

// ---- venue accounts
ok((await mgr.managedVenueIds(U.mgr))[0] === nomad.id, 'manager sees their venue');
const live = await mgr.setVenueStatus(nomad.id, 'live', 90);
ok(live.status === 'live', 'manager sets live');
ok((await anon.listVenues({ status: 'live' })).some((v) => v.id === nomad.id), 'venues_public filter by status');
await rejects(() => alice.setVenueStatus(nomad.id, 'live'), 'non-manager cannot set status');
await rejects(() => mgr.setVenueStatus(thrones.id, 'live'), 'manager cannot set another venue');
await mgr.setVenueStatus(nomad.id, 'sold_out', 60);
ok((await anon.listVenues()).find((v) => v.id === nomad.id).status === 'sold_out', 'sold out status visible');

// ---- verification request (user side)
await carol.requestVerification({ kind: 'host', role: 'Mc', message: 'MC at Thrones on Fridays' });
await rejects(() => carol.requestVerification({ kind: 'host', role: 'Dj' }), 'duplicate pending request');
ok((await carol.myVerificationRequests(U.carol)).length === 1, 'user sees own verification requests');
await carol.requestVerification({ kind: 'venue', venue_id: thrones.id, message: 'I run Thrones' });

// ---- admin
ok((await alice.adminListReports()).length === 0, 'non-admin gets an empty moderation queue');
await rejects(() => alice.adminSetUserStatus(U.bob, 'banned'), 'non-admin cannot ban');
await rejects(() => alice.adminSetContentStatus('post', p2.id, 'removed'), 'non-admin cannot remove content');
await rejects(() => alice.adminReviewVerification('00000000-0000-0000-0000-000000000000', true), 'non-admin cannot review verification');
ok((await alice.adminModerationLog()).length === 0, 'moderation log is admin-only');

const queue = await adm.adminListReports('open');
ok(queue.length === 2, 'admin sees both open reports');
const rPost = queue.find((r) => r.target_type === 'post');
ok(rPost.target_preview === 'Outside Nomad' && rPost.reporter_name === 'bob_b' && rPost.target_user_id === U.alice, 'queue shows preview, reporter, author');
await adm.adminResolveReport(rPost.id, 'actioned', 'spam', true);
ok(!(await anon.listPosts()).some((p) => p.id === p2.id), 'actioned report removed the post from the public feed');
const rComment = queue.find((r) => r.target_type === 'comment');
await adm.adminResolveReport(rComment.id, 'dismissed', 'fine');
ok((await adm.adminListReports('open')).length === 0, 'resolved reports leave the open queue');
ok((await adm.adminListReports('all')).length === 2, 'history still available');
await adm.adminSetContentStatus('comment', c1.id, 'removed', 'test');
ok((await anon.listComments(p1.id)).length === 0, 'admin removes a comment');
await adm.adminSetUserStatus(U.bob, 'suspended', 'spam');
const sus = await rejects(() => bob.createPost({ content: 'still here' }), 'suspended user cannot post', /not active/);
ok(/suspended/i.test((await import('../../src/lib/api.ts')).friendlyError(sus)), 'friendly message for suspended accounts');
const found = await adm.adminSearchUsers('bob');
ok(found.length === 1 && found[0].status === 'suspended', 'admin user search shows status');
await adm.adminSetUserStatus(U.bob, 'active', 'appeal');
await bob.createPost({ content: 'back' });
ok(true, 'reinstated user can post again');

const pend = await adm.adminListVerifications('pending');
ok(pend.length === 2, 'admin sees pending verification requests');
const hostReq = pend.find((r) => r.kind === 'host');
await adm.adminReviewVerification(hostReq.id, true, 'known MC');
ok((await carol.getProfile(U.carol)).account_type === 'host', 'approved host profile upgraded');
const venueReq = pend.find((r) => r.kind === 'venue');
await adm.adminReviewVerification(venueReq.id, false, 'cannot verify');
ok((await adm.adminListVerifications('pending')).length === 0, 'reviewed requests leave the pending list');
const log = await adm.adminModerationLog();
ok(log.length >= 6 && log.some((l) => l.action.startsWith('remove_post')), 'moderation log records admin actions');

// ---- emoji palette + live reactions (data layer)
const palette = await anon.listReactionTypes();
ok(palette.length >= 10 && palette[0].kind === 'fire' && palette.every((r) => r.emoji && r.label), 'anyone can read the emoji palette in display order');
await bob.setReaction(p1.id, U.bob, 'dance', null);
await rejects(() => alice.setReaction(p1.id, U.alice, 'nope', 'party'), 'unknown emoji is rejected by the database');
counts = await anon.reactionCounts([p1.id]);
ok(counts[p1.id].dance === 1 && counts[p1.id].party === 1, 'new palette emojis are counted per kind');
ok(Object.values(counts[p1.id]).every((n) => typeof n === 'number'), 'counts are plain numbers per kind');

// ---- venue vibes
await alice.setVenueReaction(nomad.id, U.alice, 'fire', null);
await bob.setVenueReaction(nomad.id, U.bob, 'fire', null);
let vibes = await anon.venueVibeCounts();
ok(vibes[nomad.id].fire === 2, 'venue vibe counts are public and aggregated');
ok((await alice.myVenueReactions(U.alice))[nomad.id] === 'fire' && Object.keys(await bob.myVenueReactions(U.bob)).length === 1, 'each user sees their own vibe');
ok((await alice.setVenueReaction(nomad.id, U.alice, 'music', 'fire')) === 'music', 'switch vibe');
vibes = await anon.venueVibeCounts();
ok(vibes[nomad.id].fire === 1 && vibes[nomad.id].music === 1, 'counts follow the switch');
ok((await alice.setVenueReaction(nomad.id, U.alice, 'music', 'music')) === null, 'same emoji removes the vibe');
vibes = await anon.venueVibeCounts();
ok(!vibes[nomad.id].music && vibes[nomad.id].fire === 1, 'removed vibe no longer counts');
await rejects(() => anon.setVenueReaction(nomad.id, U.alice, 'fire', null), 'anon cannot react to venues');
await rejects(() => alice.setVenueReaction(thrones.id, U.alice, 'nope', null), 'venue vibe needs a palette emoji');

// ---- camera snaps
const base = process.env.SUPABASE_PUBLIC_BASE ?? 'https://proj.supabase.co';
const mediaUrl = `${base}/storage/v1/object/public/post-media/${U.alice}/clip.jpg`;
const snap = await alice.createPost({
  content: '', kind: 'snap', media_url: mediaUrl, media_type: 'image', media_width: 720, media_height: 1280,
  media_meta: { filter: 'neon', geo: 'Kampala', tools: ['text', 'draw'] }, venue_id: nomad.id,
});
ok(snap.kind === 'snap' && snap.media_type === 'image' && snap.venue_name === 'Nomad' && snap.media_meta.filter === 'neon', 'snap created with media, venue and metadata');
ok(new Date(snap.expires_at).getTime() - Date.now() > 23.9 * 3600 * 1000, 'snap expires 24 hours after posting');
ok((await anon.listSnaps()).some((x) => x.id === snap.id), 'snaps are listed for everyone');
const vid = await alice.createPost({ content: 'live set', kind: 'snap', media_url: `${base}/storage/v1/object/public/post-media/${U.alice}/v.mp4`, media_type: 'video', media_duration_ms: 7300 });
ok(vid.media_type === 'video' && vid.media_duration_ms === 7300, 'video snap with duration');
const stolen = await rejects(() => bob.createPost({ content: '', kind: 'snap', media_url: mediaUrl, media_type: 'image' }), "cannot post media from someone else's folder");
ok(/upload failed/i.test((await import('../../src/lib/api.ts')).friendlyError(stolen)), 'friendly message for rejected media');
await rejects(() => alice.createPost({ content: '', kind: 'snap', media_url: 'https://evil.example/x.png', media_type: 'image' }), 'external media URL rejected');
await rejects(() => alice.createPost({ content: 'x', kind: 'snap' }), 'a snap needs media');
await bob.setReaction(snap.id, U.bob, 'party', null);
ok((await anon.reactionCounts([snap.id]))[snap.id].party === 1, 'snaps take reactions like any post');


// Everything below runs in its own block so its names never clash with the checks above.
{
// ---- engagement: views, bookmarks, reposts, follows, Vibe Rep
const pA = await alice.createPost({ content: 'engagement target 🔥' });
const pB = await bob.createPost({ content: 'bob post' });
ok((await bob.recordPostViews([pA.id, pB.id])) === 1, 'a view counts for other people\'s posts, not your own');
ok((await bob.recordPostViews([pA.id])) === 0, 'the same viewer is only counted once');
ok((await alice.recordPostViews([pA.id])) === 0, 'authors do not count as viewers of their own post');
await rejects(() => anon.recordPostViews([pA.id]), 'anon views are not counted');
ok((await anon.getPost(pA.id)).views === 1, 'views counter is public on the post');
ok((await bob.recordPostViews([])) === 0, 'empty view batch is a no-op');

await bob.savePost(pA.id);
await bob.savePost(pA.id); // double tap: no error
ok((await bob.savedPostIds(U.bob)).includes(pA.id), 'bookmark saved');
ok((await bob.listSavedPosts(U.bob)).map((p) => p.id).join() === pA.id, 'saved posts list returns the post');
ok(!(await alice.savedPostIds(U.alice)).includes(pA.id), 'bookmarks are private to their owner');
await rejects(() => anon.savePost(pA.id), 'anon cannot bookmark');
await bob.unsavePost(U.bob, pA.id);
ok((await bob.savedPostIds(U.bob)).length === 0, 'bookmark removed');

await bob.repost(pA.id, 'so good');
await bob.repost(pA.id); // already reposted: no error
ok((await anon.getPost(pA.id)).reposts === 1, 'repost counter updates');
ok((await bob.myRepostIds(U.bob, [pA.id, pB.id])).join() === pA.id, 'my reposts are listed');
await rejects(() => carol.repost(pA.id, 'x'.repeat(281)), 'quote longer than 280 characters is refused');
await bob.unrepost(U.bob, pA.id);
ok((await anon.getPost(pA.id)).reposts === 0, 'undo repost lowers the counter');

const vr0 = (await anon.profileStats(U.alice)).vibe_rep;
await bob.followUser(U.alice);
await bob.followUser(U.alice); // duplicate follow is not an error
ok(await bob.isFollowingUser(U.bob, U.alice), 'follow works');
ok((await anon.profileStats(U.alice)).follower_count === 1, 'follower count is public');
await rejects(() => alice.followUser(U.alice), 'cannot follow yourself');
await bob.unfollowUser(U.bob, U.alice);
ok(!(await bob.isFollowingUser(U.bob, U.alice)) && (await anon.profileStats(U.alice)).follower_count === 0, 'unfollow works');

await bob.setReaction(pA.id, U.bob, 'heart', null);
ok((await anon.profileStats(U.alice)).vibe_rep === vr0 + 1, 'Vibe Rep goes up when someone likes your post');
await alice.setReaction(pA.id, U.alice, 'heart', null);
ok((await anon.profileStats(U.alice)).vibe_rep === vr0 + 1, 'liking your own post earns no Vibe Rep');
await bob.setReaction(pA.id, U.bob, 'heart', 'heart');
ok((await anon.profileStats(U.alice)).vibe_rep === vr0, 'Vibe Rep drops when the like is removed');

// ---- statuses (24 h stories)
const st = await alice.createStatus({ media_url: mediaUrl, media_type: 'image', caption: 'status hello', venue_id: nomad.id });
ok(st.user_id === U.alice && st.venue_id === nomad.id && st.caption === 'status hello', 'status created, owner and venue set');
ok(new Date(st.expires_at).getTime() - Date.now() > 23.9 * 3600 * 1000, 'status expires after 24 hours');
const stB = await bob.createStatus({ media_url: `${base}/storage/v1/object/public/post-media/${U.bob}/story.jpg`, media_type: 'image' });
const liveStatuses = await anon.listStatuses();
ok([st.id, stB.id].every((id) => liveStatuses.some((s) => s.id === id)), 'everyone can read live statuses');
await rejects(() => bob.createStatus({ media_url: mediaUrl, media_type: 'image' }), "status media must be in the poster's own folder");
await rejects(() => alice.createStatus({ media_url: 'https://evil.example/x.png', media_type: 'image' }), 'external status media refused');
await rejects(() => anon.createStatus({ media_url: mediaUrl, media_type: 'image' }), 'anon cannot post a status');
await bob.markStatusViewed(st.id);
await bob.markStatusViewed(st.id); // already viewed: no error
ok((await bob.myStatusViews(U.bob)).includes(st.id), 'seen statuses are remembered per viewer');
ok((await alice.statusViewers(st.id)).map((v) => v.viewer_id).join() === U.bob, 'the owner sees who viewed a status');
ok((await carol.statusViewers(st.id)).length === 0, 'other people do not see the viewer list');
await bob.deleteStatus(st.id); // not his: RLS filters it out silently
ok((await anon.getStatus(st.id)) !== null, "nobody can delete someone else's status");
await bob.createReport({ target_type: 'status', target_id: st.id, reason: 'spam' });
const reportQueue = await adm.adminListReports('open');
const rep = reportQueue.find((r) => r.target_type === 'status' && r.target_id === st.id);
ok(rep && rep.target_preview === 'status hello' && rep.target_user_id === U.alice, 'status reports reach the admin queue with a preview');
await adm.adminResolveReport(rep.id, 'actioned', 'spam', true);
ok((await anon.getStatus(st.id)) === null, 'a moderator can remove a reported status');
await alice.deleteStatus((await alice.createStatus({ media_url: mediaUrl, media_type: 'image' })).id);

// ---- direct messages + secret (vanish) mode
const cid = await alice.startConversation(U.bob);
ok((await bob.startConversation(U.alice)) === cid, 'one conversation per pair');
await rejects(() => alice.startConversation(U.alice), 'cannot message yourself');
await rejects(() => anon.startConversation(U.bob), 'anon cannot start a conversation');
const m1 = await alice.sendMessage(cid, 'hi bob 👋', { type: 'post', id: pA.id });
ok(m1.sender_id === U.alice && m1.ref_type === 'post' && m1.ref_id === pA.id && m1.vanish === false && m1.read_at === null, 'message sent, sender stamped by the database');
await rejects(() => alice.sendMessage(cid, '   '), 'empty message refused');
await rejects(() => carol.sendMessage(cid, 'let me in'), 'outsiders cannot write in a conversation');
ok((await carol.listMessages(cid)).length === 0, 'outsiders cannot read a conversation');
ok((await bob.unreadMessageCount()) >= 1, 'recipient has an unread count');
const inbox = await bob.listConversations();
const row = inbox.find((c) => c.conversation_id === cid);
ok(row && row.other_user_id === U.alice && row.unread_count === 1 && row.last_body === 'hi bob 👋', 'inbox row shows the other person, unread count and last message');
ok((await bob.markConversationRead(cid)) === 1, 'opening the chat marks messages read');
ok((await bob.listMessages(cid)).every((m) => m.read_at), 'read receipts are stored');
ok((await alice.listMessages(cid))[0].read_at !== null, 'sender can see it was read');

ok((await alice.setVanishMode(cid, true)) === true && (await bob.getConversation(cid)).vanish_mode === true, 'secret mode turned on for both');
const sec = await alice.sendMessage(cid, 'this will vanish');
ok(sec.vanish === true && new Date(sec.expires_at).getTime() - Date.now() > 23 * 3600 * 1000, 'secret message carries a 24 h fallback expiry until it is read');
ok((await bob.listMessages(cid)).some((m) => m.id === sec.id), 'recipient can see it before reading');
ok((await bob.markConversationRead(cid)) === 1, 'recipient reads the secret message');
const afterRead = (await bob.listMessages(cid)).find((m) => m.id === sec.id);
ok(afterRead && new Date(afterRead.expires_at).getTime() - Date.now() < 5000, 'reading starts the vanish countdown');
await new Promise((r) => setTimeout(r, 3200));
ok(!(await bob.listMessages(cid)).some((m) => m.id === sec.id) && !(await alice.listMessages(cid)).some((m) => m.id === sec.id), 'the message is gone for both people after the countdown');
ok((await alice.setVanishMode(cid, false)) === false, 'secret mode turned off');
}

// ---- delete account
await carol.deleteMyAccount();
ok((await adm.adminSearchUsers('pulse_')).every((u) => u.id !== U.carol), 'deleted account is gone');

console.log(`\n== API SMOKE PASSED (${passed} checks) ==`);
