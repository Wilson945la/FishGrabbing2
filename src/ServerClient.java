import java.io.*;
import java.net.*;
import java.util.concurrent.*;

public class ServerClient {
    // 内网直连模式
    private static final String HOST = "172.16.162.87";
    private static final int PORT = 80;

    // natapp 穿透模式（需外网访问时取消注释）
    // private static final String HOST = "j56a69f9.natappfree.cc";
    // private static final int PORT = 45910;

    // 当前登录的用户名，用于离线状态
    private static volatile String currentUser = null;
    public static void setCurrentUser(String name) { currentUser = name; }
    public static String getCurrentUser() { return currentUser; }

    // 单连接 + 请求队列，避免多线程串读
    private static volatile Socket socket;
    private static volatile BufferedReader in;
    private static volatile PrintWriter out;
    private static final Object connLock = new Object();
    private static final Object sendLock = new Object();
    private static volatile boolean shuttingDown = false;

    /** 注册 JVM ShutdownHook，确保进程退出时关闭 Socket 连接 */
    public static void registerShutdownHook() {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            shuttingDown = true;
            closeConn();
        }, "ServerClient-ShutdownHook"));
    }

    /** 显式关闭连接（供主动退出时调用） */
    public static void shutdown() {
        shuttingDown = true;
        closeConn();
    }

    private static void ensureConn() throws IOException {
        synchronized (connLock) {
            if (socket != null && !socket.isClosed() && socket.isConnected()) {
                return;
            }
            closeConn();
            socket = new Socket();
            socket.setSoTimeout(15000);
            socket.connect(new InetSocketAddress(HOST, PORT), 8000);
            in = new BufferedReader(new InputStreamReader(socket.getInputStream()));
            out = new PrintWriter(socket.getOutputStream(), true);
        }
    }

    private static void closeConn() {
        try { if (out != null) out.flush(); } catch (Exception ignored) {}
        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
        socket = null; in = null; out = null;
    }

    /** 串行发送，保证同一时刻只有一个请求在飞行 */
    private static String send(String message) {
        synchronized (sendLock) {
            for (int attempt = 0; attempt < 2; attempt++) {
                try {
                    ensureConn();
                    out.println(message);
                    String line = in.readLine();
                    if (line == null) { closeConn(); throw new IOException("服务器关闭连接"); }
                    return line;
                } catch (ConnectException e) {
                    synchronized (connLock) { closeConn(); }
                    if (attempt == 1) return "ERROR|无法连接服务器";
                } catch (SocketTimeoutException e) {
                    synchronized (connLock) { closeConn(); }
                    if (attempt == 1) return "ERROR|请求超时，请检查网络连接";
                } catch (IOException e) {
                    synchronized (connLock) { closeConn(); }
                    if (attempt == 1) return "ERROR|网络异常: " + e.getMessage();
                }
                try { Thread.sleep(200); } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return "ERROR|请求被中断";
                }
            }
            return "ERROR|服务器无响应";
        }
    }

    public static String register(String username, String account, String password) {
        return send("REGISTER|" + username + "|" + account + "|" + password);
    }

    public static String login(String accountOrName, String password) {
        return send("LOGIN|" + accountOrName + "|" + password);
    }

    public static String changePassword(String username, String oldPassword, String newPassword) {
        return send("CHANGEPASSWORD|" + username + "|" + oldPassword + "|" + newPassword);
    }

    public static String getRecords(int userId) {
        return send("GETRECORDS|" + userId);
    }

    public static String getRecords(int userId, String gameName) {
        return send("GETRECORDS|" + userId + "|" + gameName);
    }

    public static String saveRecord(int userId, String gameName, String gameMode, String record) {
        return send("SAVERECORD|" + userId + "|" + gameName + "|" + gameMode + "|" + record);
    }

    public static String getUserId(String username) {
        return send("GETFRIENDID|" + username);
    }

    public static String getFriends(String username) {
        return send("GETFRIENDS|" + username);
    }

    public static String addFriend(String username, String targetName) {
        return send("ADDFRIEND|" + username + "|" + targetName);
    }

    public static String deleteFriend(String username, String targetName) {
        return send("DELETEFRIEND|" + username + "|" + targetName);
    }

    public static String getUserState(String username) {
        return send("GETUSERSTATE|" + username);
    }

    public static String setUserState(String username, int state) {
        return send("SETUSERSTATE|" + username + "|" + state);
    }

    public static String getMessages(String username) {
        return send("GETMESSAGES|" + username);
    }

    public static String sendChatMessage(String sender, String receiver, String message) {
        return send("SENDMESSAGE|" + sender + "|" + receiver + "|" + message);
    }

    public static String getUnreadCount(String username) {
        return send("GETUNREADCOUNT|" + username);
    }

    public static String markAllRead(String username) {
        return send("MARKALLREAD|" + username);
    }

    public static String getRecentChat(String username, String friendName, int limit) {
        return send("GETRECENTCHAT|" + username + "|" + friendName + "|" + limit);
    }

    public static String getRecentChatWithUnread(String username, String friendName, int limit) {
        return send("GETRECENTCHATUNREAD|" + username + "|" + friendName + "|" + limit);
    }

    // ===== 对决房间相关 =====
    public static String duelCreate(String username, String mode, int maxPlayers, String gameType) {
        return send("DUEL_CREATE|" + username + "|" + mode + "|" + maxPlayers + "|" + gameType);
    }
    public static String duelJoin(int roomId, String username) {
        return send("DUEL_JOIN|" + roomId + "|" + username);
    }
    public static String duelLeave(int roomId, String username) {
        return send("DUEL_LEAVE|" + roomId + "|" + username);
    }
    public static String duelReady(int roomId, String username) {
        return send("DUEL_READY|" + roomId + "|" + username);
    }
    public static String duelInfo(int roomId) {
        return send("DUEL_INFO|" + roomId);
    }
    public static String duelUpdateMax(int roomId, String username, int maxPlayers) {
        return send("DUEL_UPDATE_MAX|" + roomId + "|" + username + "|" + maxPlayers);
    }
    public static String duelMatch(int roomId, String username, String mode, int maxPlayers) {
        return send("DUEL_MATCH|" + roomId + "|" + username + "|" + mode + "|" + maxPlayers);
    }
    public static String duelMatchCancel(int roomId, String username) {
        return send("DUEL_MATCH_CANCEL|" + roomId + "|" + username);
    }
    /** 自定义房间：房主手动添加机器人 */
    public static String duelAddBot(int roomId, String username) {
        return send("DUEL_ADD_BOT|" + roomId + "|" + username);
    }

    // ===== 对决游戏内操作 =====
    public static String duelGameReveal(int roomId, String username, int row, int col, int value) {
        return send("DUEL_GAME_REVEAL|" + roomId + "|" + username + "|" + row + "|" + col + "|" + value);
    }
    public static String duelGameFlag(int roomId, String username, int row, int col) {
        return send("DUEL_GAME_FLAG|" + roomId + "|" + username + "|" + row + "|" + col);
    }
    public static String duelGameUnflag(int roomId, String username, int row, int col) {
        return send("DUEL_GAME_UNFLAG|" + roomId + "|" + username + "|" + row + "|" + col);
    }
    public static String duelGameResult(int roomId, String username, String result, long finishTime) {
        return duelGameResult(roomId, username, result, finishTime, 0);
    }
    public static String duelGameResult(int roomId, String username, String result, long finishTime, int score) {
        return send("DUEL_GAME_RESULT|" + roomId + "|" + username + "|" + result + "|" + finishTime + "|" + score);
    }
    /** 轮询查询对决游戏结果 */
    public static String duelGameResults(int roomId) {
        return send("DUEL_GAME_RESULTS|" + roomId);
    }
    /** 对决聊天（不存库，纯推送中转） */
    public static String duelChat(int roomId, String username, String message) {
        return send("DUEL_CHAT|" + roomId + "|" + username + "|" + message);
    }
    /** 对决中同步分数给其他玩家（2048 用，已废弃，改用 duelGameBoard） */
    public static String duelGameScore(int roomId, String username, int score) {
        return send("DUEL_GAME_SCORE|" + roomId + "|" + username + "|" + score);
    }
    /** 对决中同步完整局面给其他玩家（2048 用）：boardData 为 16 个数字逗号分隔 */
    public static String duelGameBoard(int roomId, String username, int score, String boardData) {
        return send("DUEL_GAME_BOARD|" + roomId + "|" + username + "|" + score + "|" + boardData);
    }
    /** 查询游戏启动状态（兜底：推送丢失时主动获取种子） */
    public static String duelGameState(int roomId) {
        return send("DUEL_GAME_STATE|" + roomId);
    }
}
