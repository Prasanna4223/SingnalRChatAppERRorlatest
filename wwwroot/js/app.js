// ═══════════════════════════════════════════════════════
//  SignalR Video Chat - app.js
// ═══════════════════════════════════════════════════════

// ─── State ───
let myId = null;
let myName = "";
let selectedUserId = null;
let selectedUserName = "";
let currentPeerId = null;
let peerConnection = null;
let localStream = null;
let localHasVideo = false;
let localHasAudio = false;
let isInCall = false;
let pendingIceCandidates = [];

// ─── Per-user chat history ───
const chatHistories = new Map();

// ─── Cached user list ───
let latestUserList = [];

// ─── SignalR Hub ───
const hub = new signalR.HubConnectionBuilder()
    .withUrl("/callHub")
    .withAutomaticReconnect()
    .build();

// ─── DOM Elements ───
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const chatMessages = document.getElementById("chatMessages");
const messageInput = document.getElementById("message");
const userListEl = document.getElementById("activeUsersList");
const endCallBtn = document.getElementById("endCall");
const toggleVideoBtn = document.getElementById("toggleVideo");
const toggleAudioBtn = document.getElementById("toggleAudio");
const chatTargetName = document.getElementById("chatTargetName");

remoteVideo.autoplay = true;
remoteVideo.playsInline = true;
localVideo.autoplay = true;
localVideo.playsInline = true;
localVideo.muted = true;

// ─── ICE Configuration (STUN + TURN for remote connectivity) ───
const ICE_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ],
    iceCandidatePoolSize: 10
};

// ═══════════════════════════════════════════════════════
//  MOBILE SIDEBAR TOGGLE
// ═══════════════════════════════════════════════════════

const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const hamburgerBtn = document.getElementById("hamburgerBtn");
const sidebarClose = document.getElementById("sidebarClose");

function openSidebar() {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("show");
}
function closeSidebar() {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("show");
}

hamburgerBtn.onclick = openSidebar;
sidebarClose.onclick = closeSidebar;
sidebarOverlay.onclick = closeSidebar;

// ═══════════════════════════════════════════════════════
//  1. JOIN / REGISTRATION
// ═══════════════════════════════════════════════════════

// DND Toggle
const dndToggle = document.createElement("button");
dndToggle.className = "dnd-toggle";
dndToggle.textContent = "🟢 Available";
dndToggle.onclick = () => {
    const isOn = dndToggle.classList.toggle("on");
    dndToggle.textContent = isOn ? "🔴 DND" : "🟢 Available";
    hub.invoke("ToggleDnd", isOn);
};
sidebar.querySelector(".sidebar-header").after(dndToggle);

// Join button
document.getElementById("joinBtn").onclick = async () => {
    myName = document.getElementById("displayname").value.trim();
    if (!myName) return alert("Please enter your name!");

    try {
        await hub.start();
        // Set myId BEFORE Register so UserListUpdated knows who "me" is
        myId = hub.connectionId;
        console.log("Connected, myId:", myId);

        await hub.invoke("Register", myName);
        document.querySelector(".username-popup").style.display = "none";
        console.log("Registered as:", myName);

        // Re-render cached list now that myId is set
        if (latestUserList.length > 0) renderUserList(latestUserList);
    } catch (err) {
        console.error("Connection failed:", err);
        alert("Failed to connect: " + err.toString());
    }
};

// Enter key to join
document.getElementById("displayname").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("joinBtn").click();
});

// ═══════════════════════════════════════════════════════
//  2. USER LIST
// ═══════════════════════════════════════════════════════

hub.on("UserListUpdated", (users) => {
    console.log("UserListUpdated received, count:", users.length, "myId:", myId);
    latestUserList = users;
    renderUserList(users);
});

function renderUserList(users) {
    userListEl.innerHTML = "";

    users.forEach(user => {
        const li = document.createElement("li");
        li.dataset.id = user.id;

        const displayName = user.name || "Anonymous";
        let statusIcons = "";
        if (user.isDoNotDisturb) statusIcons += " 🚫";
        if (user.isInCall) statusIcons += " 📞";

        // Unread badge
        const history = chatHistories.get(user.id);
        const unread = history ? history.filter(m => m.unread).length : 0;

        li.innerHTML = `<span class="user-name">${displayName}</span>` +
            (unread > 0 ? `<span class="unread-badge">${unread}</span>` : '') +
            `<span class="user-status">${statusIcons}</span>`;

        if (user.isInCall) li.classList.add("user-busy");

        if (user.id === myId) {
            li.classList.add("current-user");
            li.innerHTML += ` <span class="badge">(You)</span>`;
        } else {
            if (user.id === selectedUserId) li.classList.add("selected");

            li.onclick = () => {
                document.querySelectorAll("#activeUsersList li").forEach(x => x.classList.remove("selected"));
                li.classList.add("selected");
                switchChat(user.id, displayName);
                closeSidebar();
            };

            li.ondblclick = () => {
                if (user.isInCall || user.isDoNotDisturb) {
                    showNotification("User is busy or unavailable", "warning");
                    return;
                }
                initiateCall(user.id, displayName);
            };

            li.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                showContextMenu(e, user.id, displayName, user.isInCall, user.isDoNotDisturb);
            });
        }

        userListEl.appendChild(li);
    });
}

// ═══════════════════════════════════════════════════════
//  3. PER-USER CHAT HISTORY
// ═══════════════════════════════════════════════════════

function switchChat(userId, userName) {
    selectedUserId = userId;
    selectedUserName = userName;
    chatTargetName.textContent = userName;
    messageInput.placeholder = `Message ${userName}...`;

    const history = chatHistories.get(userId);
    if (history) history.forEach(m => m.unread = false);

    renderChat(userId);
    refreshUnreadBadges();
}

function renderChat(userId) {
    chatMessages.innerHTML = "";
    const history = chatHistories.get(userId) || [];

    history.forEach(msg => {
        const div = document.createElement("div");
        div.className = msg.isMine ? "msg msg-sent" : "msg msg-received";
        div.innerHTML = `<strong>${msg.sender}</strong> <small>${msg.timestamp}</small><br>${escapeHtml(msg.message)}`;
        chatMessages.appendChild(div);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addMessageToHistory(peerId, sender, message, timestamp, isMine) {
    if (!chatHistories.has(peerId)) {
        chatHistories.set(peerId, []);
    }
    chatHistories.get(peerId).push({
        sender, message, timestamp, isMine,
        unread: !isMine && peerId !== selectedUserId
    });
}

function refreshUnreadBadges() {
    document.querySelectorAll("#activeUsersList li").forEach(li => {
        const uid = li.dataset.id;
        if (!uid || uid === myId) return;
        const history = chatHistories.get(uid);
        const unread = history ? history.filter(m => m.unread).length : 0;
        const existing = li.querySelector(".unread-badge");
        if (existing) existing.remove();
        if (unread > 0) {
            const badge = document.createElement("span");
            badge.className = "unread-badge";
            badge.textContent = unread;
            li.querySelector(".user-name").after(badge);
        }
    });
}

// ═══════════════════════════════════════════════════════
//  4. CONTEXT MENU
// ═══════════════════════════════════════════════════════

function showContextMenu(event, userId, userName, userInCall, isDnd) {
    document.querySelectorAll(".context-menu").forEach(m => m.remove());

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = Math.min(event.clientX, window.innerWidth - 180) + "px";
    menu.style.top = Math.min(event.clientY, window.innerHeight - 120) + "px";

    const callOption = document.createElement("div");
    callOption.className = "context-menu-item";
    callOption.innerHTML = "📞 Call";
    if (userInCall || isDnd || isInCall) {
        callOption.classList.add("disabled");
    } else {
        callOption.onclick = () => { initiateCall(userId, userName); menu.remove(); };
    }

    const msgOption = document.createElement("div");
    msgOption.className = "context-menu-item";
    msgOption.innerHTML = "💬 Message";
    msgOption.onclick = () => {
        switchChat(userId, userName);
        document.querySelectorAll("#activeUsersList li").forEach(x => x.classList.remove("selected"));
        const targetLi = document.querySelector(`#activeUsersList li[data-id="${userId}"]`);
        if (targetLi) targetLi.classList.add("selected");
        messageInput.focus();
        menu.remove();
    };

    menu.appendChild(callOption);
    menu.appendChild(msgOption);
    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener("click", function closeMenu() {
            menu.remove();
            document.removeEventListener("click", closeMenu);
        });
    }, 50);
}

// ═══════════════════════════════════════════════════════
//  5. CALLING — Outgoing
// ═══════════════════════════════════════════════════════

async function initiateCall(userId, userName) {
    if (isInCall || peerConnection) {
        showNotification("You are already in a call!", "warning");
        return;
    }

    selectedUserId = userId;
    currentPeerId = userId;

    try {
        await startLocalStream(true, true);
        showNotification(`Calling ${userName}...`, "info");
        createPeerConnection();

        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);

        await hub.invoke("SendOffer", userId,
            { type: offer.type, sdp: offer.sdp },
            localHasVideo, localHasAudio
        );
    } catch (err) {
        console.error("Failed to initiate call:", err);
        showNotification("Failed to start call: " + err.message, "error");
        cleanupCall();
    }
}

// ═══════════════════════════════════════════════════════
//  6. CALLING — Incoming
// ═══════════════════════════════════════════════════════

hub.on("IncomingCall", (callerId, callerName, offer, hasVideo, hasAudio) => {
    console.log("Incoming call from:", callerName);

    if (isInCall) {
        hub.invoke("RejectCall", callerId, "User is busy");
        return;
    }

    currentPeerId = callerId;

    const mediaInfo = [];
    if (hasVideo) mediaInfo.push("📹 Video");
    if (hasAudio) mediaInfo.push("🎤 Audio");

    document.getElementById("callerName").textContent = callerName;
    document.getElementById("callMediaInfo").textContent = mediaInfo.join(" + ") || "Call";
    document.getElementById("incomingCallPopup").classList.add("show");

    document.getElementById("acceptCallPopup").onclick = async () => {
        document.getElementById("incomingCallPopup").classList.remove("show");
        try {
            await startLocalStream(true, true);
            createPeerConnection();

            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            for (const candidate of pendingIceCandidates) {
                await peerConnection.addIceCandidate(candidate);
            }
            pendingIceCandidates = [];

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            await hub.invoke("AcceptCall", callerId);
            await hub.invoke("SendAnswer", callerId,
                { type: answer.type, sdp: answer.sdp },
                localHasVideo, localHasAudio
            );

            isInCall = true;
            showCallControls();
            showNotification("Call connected!", "success");
        } catch (err) {
            console.error("Failed to accept call:", err);
            hub.invoke("RejectCall", callerId, "Connection failed");
            cleanupCall();
        }
    };

    document.getElementById("rejectCallPopup").onclick = async () => {
        document.getElementById("incomingCallPopup").classList.remove("show");
        await hub.invoke("RejectCall", callerId, "Call declined");
        currentPeerId = null;
    };
});

// ═══════════════════════════════════════════════════════
//  7. SIGNALING — Answer, ICE, Call State
// ═══════════════════════════════════════════════════════

hub.on("CallAccepted", (calleeId) => {
    isInCall = true;
    showCallControls();
    showNotification("Call accepted!", "success");
});

hub.on("ReceiveAnswer", async (answer, hasVideo, hasAudio) => {
    if (!peerConnection) return;
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        for (const candidate of pendingIceCandidates) {
            await peerConnection.addIceCandidate(candidate);
        }
        pendingIceCandidates = [];
    } catch (err) {
        console.error("Failed to set remote answer:", err);
    }
});

hub.on("ReceiveIceCandidate", async (senderId, candidate) => {
    if (!peerConnection) return;
    const iceCandidate = new RTCIceCandidate(candidate);

    if (!peerConnection.remoteDescription || !peerConnection.remoteDescription.type) {
        pendingIceCandidates.push(iceCandidate);
        return;
    }

    try {
        await peerConnection.addIceCandidate(iceCandidate);
    } catch (err) {
        console.error("Failed to add ICE candidate:", err);
    }
});

hub.on("CallRejected", (reason) => {
    showNotification(reason || "Call rejected", "warning");
    cleanupCall();
});

hub.on("CallEnded", () => {
    showNotification("Call ended", "info");
    cleanupCall();
});

hub.on("PeerVideoToggled", (enabled) => {
    const s = remoteVideo.srcObject;
    if (s) s.getVideoTracks().forEach(t => t.enabled = enabled);
    showNotification(enabled ? "Peer turned on video" : "Peer turned off video", "info");
});

hub.on("PeerAudioToggled", (enabled) => {
    const s = remoteVideo.srcObject;
    if (s) s.getAudioTracks().forEach(t => t.enabled = enabled);
    showNotification(enabled ? "Peer unmuted" : "Peer muted", "info");
});

// ═══════════════════════════════════════════════════════
//  8. WEBRTC — Media & PeerConnection
// ═══════════════════════════════════════════════════════

async function startLocalStream(requestVideo, requestAudio) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: requestVideo ? {
                width: { ideal: 640, max: 1280 },
                height: { ideal: 480, max: 720 },
                facingMode: "user"
            } : false,
            audio: requestAudio ? {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } : false
        });
        localVideo.srcObject = localStream;
        localHasVideo = requestVideo && localStream.getVideoTracks().length > 0;
        localHasAudio = requestAudio && localStream.getAudioTracks().length > 0;
    } catch (err) {
        console.warn("Media access failed:", err);
        localHasVideo = false;
        localHasAudio = false;
        showNotification("Camera/Mic access denied.", "warning");
    }
}

function createPeerConnection() {
    if (peerConnection) peerConnection.close();
    peerConnection = new RTCPeerConnection(ICE_CONFIG);

    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    const remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    peerConnection.ontrack = (event) => {
        console.log("Remote track:", event.track.kind);
        remoteStream.addTrack(event.track);
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && currentPeerId) {
            hub.invoke("SendIceCandidate", currentPeerId, event.candidate.toJSON()).catch(console.error);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log("Connection:", peerConnection.connectionState);
        if (peerConnection.connectionState === "failed") {
            showNotification("Connection failed — check network", "error");
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE:", peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === "disconnected") {
            showNotification("Connection unstable...", "warning");
        }
    };
}

// ═══════════════════════════════════════════════════════
//  9. CALL CONTROLS
// ═══════════════════════════════════════════════════════

endCallBtn.onclick = () => {
    if (currentPeerId) hub.invoke("EndCall", currentPeerId).catch(console.error);
    cleanupCall();
};

toggleVideoBtn.onclick = () => {
    if (!localStream) return;
    const t = localStream.getVideoTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    localHasVideo = t.enabled;
    toggleVideoBtn.textContent = t.enabled ? "📹 On" : "📹 Off";
    toggleVideoBtn.classList.toggle("toggled-off", !t.enabled);
    if (currentPeerId) hub.invoke("ToggleVideo", currentPeerId, t.enabled).catch(console.error);
};

toggleAudioBtn.onclick = () => {
    if (!localStream) return;
    const t = localStream.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    localHasAudio = t.enabled;
    toggleAudioBtn.textContent = t.enabled ? "🎤 On" : "🎤 Off";
    toggleAudioBtn.classList.toggle("toggled-off", !t.enabled);
    if (currentPeerId) hub.invoke("ToggleAudio", currentPeerId, t.enabled).catch(console.error);
};

function showCallControls() {
    document.querySelector(".video-container").style.display = "flex";
    endCallBtn.classList.add("active");
    toggleVideoBtn.classList.add("active");
    toggleAudioBtn.classList.add("active");
    toggleVideoBtn.textContent = "📹 On";
    toggleAudioBtn.textContent = "🎤 On";
}

function hideCallControls() {
    document.querySelector(".video-container").style.display = "none";
    endCallBtn.classList.remove("active");
    toggleVideoBtn.classList.remove("active");
    toggleAudioBtn.classList.remove("active");
}

// ═══════════════════════════════════════════════════════
//  10. CLEANUP
// ═══════════════════════════════════════════════════════

function cleanupCall() {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    currentPeerId = null;
    isInCall = false;
    localHasVideo = false;
    localHasAudio = false;
    hideCallControls();
}

// ═══════════════════════════════════════════════════════
//  11. PRIVATE CHAT (with per-user history)
// ═══════════════════════════════════════════════════════

document.getElementById("sendmessage").onclick = sendMessage;
messageInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });

function sendMessage() {
    const msg = messageInput.value.trim();
    if (!msg) return;
    if (!selectedUserId) { showNotification("Select a user first!", "warning"); return; }
    hub.invoke("SendPrivateMessage", selectedUserId, msg);
    messageInput.value = "";
}

hub.on("ReceivePrivateMessage", (sender, message, timestamp, peerId) => {
    const isMine = sender === "You";
    addMessageToHistory(peerId, sender, message, timestamp, isMine);

    if (peerId === selectedUserId) {
        const div = document.createElement("div");
        div.className = isMine ? "msg msg-sent" : "msg msg-received";
        div.innerHTML = `<strong>${sender}</strong> <small>${timestamp}</small><br>${escapeHtml(message)}`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        const h = chatHistories.get(peerId);
        if (h) h.forEach(m => m.unread = false);
    }

    refreshUnreadBadges();
});

// ═══════════════════════════════════════════════════════
//  12. UTILITIES
// ═══════════════════════════════════════════════════════

function escapeHtml(text) {
    const d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML;
}

function showNotification(message, type = "info") {
    const n = document.createElement("div");
    n.className = `notification notification-${type}`;
    n.textContent = message;
    document.body.appendChild(n);
    requestAnimationFrame(() => n.classList.add("show"));
    setTimeout(() => {
        n.classList.remove("show");
        setTimeout(() => n.remove(), 300);
    }, 3000);
}

// ═══════════════════════════════════════════════════════
//  13. RECONNECTION
// ═══════════════════════════════════════════════════════

hub.onreconnected(async (connectionId) => {
    console.log("Reconnected:", connectionId);
    myId = connectionId;
    if (myName) {
        await hub.invoke("Register", myName);
        if (latestUserList.length > 0) renderUserList(latestUserList);
    }
    cleanupCall();
    showNotification("Reconnected!", "success");
});

hub.onclose(() => {
    console.log("Hub closed");
    cleanupCall();
    showNotification("Connection lost. Reconnecting...", "error");
});