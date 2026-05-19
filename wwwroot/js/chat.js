let myConnectionId;
let displayName;

/*const chatHub = new signalR.HubConnectionBuilder().withUrl("/chatHub").build();*/
const callHub = new signalR.HubConnectionBuilder().withUrl("/callHub").build();

document.getElementById("joinBtn").onclick = async () => {
    displayName = document.getElementById("displayname").value.trim();
    if (!displayName) return alert("Enter your name!");

   /* await chatHub.start();*/
    await callHub.start();

   /* myConnectionId = chatHub.connectionId;*/
  /*  await chatHub.invoke("RegisterUser", displayName);*/
    await callHub.invoke("Register", displayName);

    document.querySelector(".username-popup").style.display = "none";
};

// Update active users
callHub.on("UpdateUserList", users => {
    const listEl = document.getElementById("activeUsersList");
    listEl.innerHTML = "";
    Object.entries(users).forEach(([id, name]) => {
       
        const li = document.createElement("li");
        li.textContent = name;
        li.dataset.id = id;
        li.onclick = () => selectedUserId = id;
        listEl.appendChild(li);
    });
});

// Receive private messages
//chatHub.on("ReceiveMessage", (sender, message) => {
//    const chatBox = document.getElementById("chatMessages");
//    const msgEl = document.createElement("div");
//    msgEl.textContent = `${sender}: ${message}`;
//    chatBox.appendChild(msgEl);
//    chatBox.scrollTop = chatBox.scrollHeight;
//});

// Send message
//document.getElementById("sendmessage").onclick = () => {
//    const message = document.getElementById("message").value.trim();
//    if (!selectedUserId) return alert("Select a user first!");
//    chatHub.invoke("SendMessage", myConnectionId, selectedUserId, message);
//    document.getElementById("message").value = "";
//};
