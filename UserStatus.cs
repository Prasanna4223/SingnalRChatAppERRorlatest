namespace SignalRChatApplication
{
    public class UserInfo
    {
        public string ConnectionId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsDoNotDisturb { get; set; }
        public bool IsInCall { get; set; }
        public string? InCallWith { get; set; } // Track who the user is in call with
        public bool IsOnline { get; set; }
    }
}
