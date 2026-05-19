using Microsoft.AspNetCore.SignalR;

namespace SignalRChatApplication
{
    public class CallHub : Hub
    {
        // Thread-safe: use ConcurrentDictionary in production, but for single-server this works
        private static readonly Dictionary<string, UserInfo> Users = new();
        private static readonly object _lock = new();

        // ─── Registration ───
        public async Task<string> Register(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) name = "Guest";

            var info = new UserInfo
            {
                ConnectionId = Context.ConnectionId,
                Name = name.Trim(),
                IsDoNotDisturb = false,
                IsInCall = false,
                InCallWith = null,
                IsOnline = true
            };

            lock (_lock) { Users[Context.ConnectionId] = info; }
            await BroadcastUserList();
            return Context.ConnectionId; // Return actual connection ID so client can identify itself
        }

        // ─── Do Not Disturb ───
        public async Task ToggleDnd(bool enabled)
        {
            lock (_lock)
            {
                if (Users.TryGetValue(Context.ConnectionId, out var info))
                    info.IsDoNotDisturb = enabled;
            }
            await BroadcastUserList();
        }

        // ─── Private Messaging ───
        public async Task SendPrivateMessage(string receiverId, string message)
        {
            if (string.IsNullOrWhiteSpace(message)) return;

            UserInfo? sender, receiver;
            lock (_lock)
            {
                if (!Users.TryGetValue(Context.ConnectionId, out sender)) return;
                if (!Users.TryGetValue(receiverId, out receiver)) return;
            }

            var timestamp = DateTime.UtcNow.ToString("HH:mm");

            await Clients.Client(receiverId).SendAsync("ReceivePrivateMessage",
                sender.Name, message, timestamp, Context.ConnectionId);

            await Clients.Caller.SendAsync("ReceivePrivateMessage",
                "You", message, timestamp, receiverId);
        }

        // ─── Initiate Call (Send Offer) ───
        // NOTE: Don't mark users as "in call" here — only after AcceptCall
        public async Task SendOffer(string receiverId, object offer, bool hasVideo, bool hasAudio)
        {
            if (offer == null) return;

            UserInfo? caller, receiver;
            lock (_lock)
            {
                if (!Users.TryGetValue(Context.ConnectionId, out caller))
                {
                    // caller session invalid, nothing to do
                    return;
                }
                if (!Users.TryGetValue(receiverId, out receiver))
                {
                    Clients.Caller.SendAsync("CallRejected", "User not found").Wait();
                    return;
                }
            }

            if (receiver.IsDoNotDisturb)
            {
                await Clients.Caller.SendAsync("CallRejected", $"{receiver.Name} has Do Not Disturb enabled");
                return;
            }

            if (receiver.IsInCall)
            {
                await Clients.Caller.SendAsync("CallRejected", $"{receiver.Name} is busy on another call");
                return;
            }

            // Send incoming call notification — don't mark as busy yet
            await Clients.Client(receiverId).SendAsync("IncomingCall",
                Context.ConnectionId, caller.Name, offer, hasVideo, hasAudio);
        }

        // ─── Accept Call ───
        public async Task AcceptCall(string callerId)
        {
            lock (_lock)
            {
                if (!Users.ContainsKey(Context.ConnectionId) || !Users.ContainsKey(callerId)) return;

                Users[Context.ConnectionId].IsInCall = true;
                Users[Context.ConnectionId].InCallWith = callerId;

                Users[callerId].IsInCall = true;
                Users[callerId].InCallWith = Context.ConnectionId;
            }

            await BroadcastUserList();
            await Clients.Client(callerId).SendAsync("CallAccepted", Context.ConnectionId);
        }

        // ─── Reject Call ───
        public async Task RejectCall(string callerId, string reason = "Call declined")
        {
            lock (_lock)
            {
                if (Users.TryGetValue(Context.ConnectionId, out var receiver))
                {
                    receiver.IsInCall = false;
                    receiver.InCallWith = null;
                }
                if (Users.TryGetValue(callerId, out var caller))
                {
                    caller.IsInCall = false;
                    caller.InCallWith = null;
                }
            }

            await BroadcastUserList();
            await Clients.Client(callerId).SendAsync("CallRejected", reason);
        }

        // ─── End Call ───
        public async Task EndCall(string peerId)
        {
            lock (_lock)
            {
                if (Users.TryGetValue(Context.ConnectionId, out var me))
                {
                    me.IsInCall = false;
                    me.InCallWith = null;
                }
                if (Users.TryGetValue(peerId, out var peer))
                {
                    peer.IsInCall = false;
                    peer.InCallWith = null;
                }
            }

            await BroadcastUserList();
            await Clients.Client(peerId).SendAsync("CallEnded");
            await Clients.Caller.SendAsync("CallEnded");
        }

        // ─── WebRTC Signaling ───
        public async Task SendAnswer(string callerId, object answer, bool hasVideo, bool hasAudio)
        {
            if (answer != null && Users.ContainsKey(callerId))
                await Clients.Client(callerId).SendAsync("ReceiveAnswer", answer, hasVideo, hasAudio);
        }

        public async Task SendIceCandidate(string targetId, object candidate)
        {
            if (candidate != null && Users.ContainsKey(targetId))
                await Clients.Client(targetId).SendAsync("ReceiveIceCandidate", Context.ConnectionId, candidate);
        }

        // ─── Media Toggles ───
        public async Task ToggleVideo(string peerId, bool enabled)
        {
            if (Users.ContainsKey(peerId))
                await Clients.Client(peerId).SendAsync("PeerVideoToggled", enabled);
        }

        public async Task ToggleAudio(string peerId, bool enabled)
        {
            if (Users.ContainsKey(peerId))
                await Clients.Client(peerId).SendAsync("PeerAudioToggled", enabled);
        }

        // ─── Connection Lifecycle ───
        public override async Task OnConnectedAsync()
        {
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? ex)
        {
            string? peerToNotify = null;

            lock (_lock)
            {
                if (Users.TryGetValue(Context.ConnectionId, out var user))
                {
                    // If user was in a call, free the peer
                    if (user.IsInCall && user.InCallWith != null)
                    {
                        peerToNotify = user.InCallWith;
                        if (Users.TryGetValue(peerToNotify, out var peer))
                        {
                            peer.IsInCall = false;
                            peer.InCallWith = null;
                        }
                    }
                    Users.Remove(Context.ConnectionId);
                }
            }

            if (peerToNotify != null)
                await Clients.Client(peerToNotify).SendAsync("CallEnded");

            await BroadcastUserList();
            await base.OnDisconnectedAsync(ex);
        }

        // ─── Broadcast ───
        private async Task BroadcastUserList()
        {
            List<object> userList;
            lock (_lock)
            {
                userList = Users.Values
                    .Where(u => u.IsOnline)
                    .Select(u => new
                    {
                        id = u.ConnectionId,
                        name = u.Name,
                        isDoNotDisturb = u.IsDoNotDisturb,
                        isInCall = u.IsInCall,
                        isOnline = u.IsOnline
                    })
                    .Cast<object>()
                    .ToList();
            }

            await Clients.All.SendAsync("UserListUpdated", userList);
        }
    }
}
