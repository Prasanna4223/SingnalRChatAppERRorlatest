//using Microsoft.AspNetCore.SignalR;
//using System;
//using System.Threading.Tasks;

//namespace SignalRChatApplication
//{
//    public class ChatHub : Hub
//    {
//        // Send message method called by the client
//        public async Task SendMessage(string user, string message)
//        {
//            try
//            {
//                Console.WriteLine($"SendMessage called by {user}: {message}");
//                // Check if the user or message is empty
//                if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(message))
//                {
//                    throw new ArgumentException("User or message cannot be empty.");
//                }

//                // Send the message to all connected clients
//                await Clients.All.SendAsync("ReceiveMessage", user, message);
//                Console.WriteLine("Message broadcasted to all clients.");
//            }
//            catch (Exception ex)
//            {
//                // Log the error with a more detailed message
//                Console.WriteLine($"Error in SendMessage: {ex.Message}");
//                // Optionally log the full exception stack trace for debugging
//                Console.WriteLine(ex.StackTrace);
//                throw;
//            }
//        }

//        // This is called when a client connects
//        public override async Task OnConnectedAsync()
//        {
//            Console.WriteLine($"A client connected: {Context.ConnectionId}");
//            await base.OnConnectedAsync();
//        }

//        // This is called when a client disconnects
//        //public override async Task OnDisconnectedAsync(Exception exception)
//        //{
//        //    Console.WriteLine($"A client disconnected: {Context.ConnectionId}");
//        //    if (exception != null)
//        //    {
//        //        Console.WriteLine($"Disconnected with error: {exception.Message}");
//        //    }
//        //    await base.OnDisconnectedAsync(exception);
//        //}
//    }
//}

using Microsoft.AspNetCore.SignalR;
using System;
using System.Threading.Tasks;

namespace SignalRChatApplication
{
    public class ChatHub : Hub
    {
        // Send message method called by the client
        public async Task SendMessage(string user, string message)
        {
            try
            {
                Console.WriteLine($"SendMessage called by {user}: {message}");
                // Check if the user or message is empty
                if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(message))
                {
                    throw new ArgumentException("User or message cannot be empty.");
                }

                // Send the message to all connected clients
                await Clients.All.SendAsync("ReceiveMessage", user, message);
                Console.WriteLine("Message broadcasted to all clients.");
            }
            catch (Exception ex)
            {
                // Log the error with a more detailed message
                Console.WriteLine($"Error in SendMessage: {ex.Message}");
                // Optionally log the full exception stack trace for debugging
                Console.WriteLine(ex.StackTrace);
                throw;
            }
        }

        // This is called when a client connects
        public override async Task OnConnectedAsync()
        {
            Console.WriteLine($"A client connected: {Context.ConnectionId}");
            await base.OnConnectedAsync();
        }

        // This is called when a client disconnects
        //public override async Task OnDisconnectedAsync(Exception exception)
        //{
        //    Console.WriteLine($"A client disconnected: {Context.ConnectionId}");
        //    if (exception != null)
        //    {
        //        Console.WriteLine($"Disconnected with error: {exception.Message}");
        //    }
        //    await base.OnDisconnectedAsync(exception);
        //}
    }
}
