import javax.swing.*;
import javax.swing.border.*;
import java.awt.*;
import java.awt.event.*;
import java.util.*;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 2048 对决游戏页面
 * 每个玩家独立玩 2048，限时 3 分钟，比拼分数
 */
public class Game2048DuelGame extends JFrame {

    private static final int SIZE = 4;
    private static final Color BG = new Color(50, 53, 56);
    private static final Color CARD_BG = new Color(60, 63, 65);
    private static final Color GRID_BG = new Color(60, 63, 65);
    private static final Color CELL_BG = new Color(70, 73, 76);

    private static final Map<Integer, Color> TILE_COLORS = new HashMap<>();
    static {
        TILE_COLORS.put(0, new Color(70, 73, 76));
        TILE_COLORS.put(2, new Color(238, 228, 218));
        TILE_COLORS.put(4, new Color(237, 224, 200));
        TILE_COLORS.put(8, new Color(242, 177, 121));
        TILE_COLORS.put(16, new Color(245, 149, 99));
        TILE_COLORS.put(32, new Color(246, 124, 95));
        TILE_COLORS.put(64, new Color(246, 94, 59));
        TILE_COLORS.put(128, new Color(237, 207, 114));
        TILE_COLORS.put(256, new Color(237, 204, 97));
        TILE_COLORS.put(512, new Color(237, 200, 80));
        TILE_COLORS.put(1024, new Color(237, 197, 63));
        TILE_COLORS.put(2048, new Color(237, 194, 46));
    }

    private String username;
    private int roomId;
    private long seed;
    private String mode;
    private int userId;
    private List<String> allPlayers;
    private JFrame parentRoom;

    private int[][] board = new int[SIZE][SIZE];
    private int score = 0;
    private boolean gameOver = false;
    private boolean localFinished = false;
    private boolean resultDialogShown = false;

    private JLabel scoreLabel;
    private JLabel timerLabel;
    private JPanel gridPanel;
    private JLabel[][] tileLabels;

    private long startTime;
    private javax.swing.Timer timer;
    private static final long TIME_LIMIT_MS = 180_000; // 3 分钟
    private volatile long lastScoreSyncTime = 0; // 分数同步节流

    private javax.swing.Timer resultPollTimer;

    // 对手局面视图 name -> OpponentView
    private Map<String, OpponentView> opponentViews = new LinkedHashMap<>();

    // 活跃游戏实例
    private static final ConcurrentHashMap<Integer, Game2048DuelGame> activeGames = new ConcurrentHashMap<>();

    public Game2048DuelGame(String username, int roomId, long seed, String mode,
                            List<String> allPlayers, JFrame parentRoom, int userId) {
        this.username = username;
        this.roomId = roomId;
        this.seed = seed;
        this.mode = mode;
        this.allPlayers = allPlayers;
        this.parentRoom = parentRoom;
        this.userId = userId;

        activeGames.put(roomId, this);

        setTitle("2048 对决");
        setDefaultCloseOperation(JFrame.DO_NOTHING_ON_CLOSE);
        setResizable(false);

        addWindowListener(new WindowAdapter() {
            public void windowClosing(WindowEvent e) {
                int choice = JOptionPane.showConfirmDialog(Game2048DuelGame.this,
                    "确定要退出游戏吗？", "确认退出", JOptionPane.YES_NO_OPTION);
                if (choice == JOptionPane.YES_OPTION) {
                    if (!localFinished) {
                        sendResult("FAIL");
                    }
                    MessageCenter.disposeActive();
                    returnToRoom();
                }
            }
        });

        initUI();
        initGame(seed);

        InputMap im = getRootPane().getInputMap(JComponent.WHEN_IN_FOCUSED_WINDOW);
        ActionMap am = getRootPane().getActionMap();
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_LEFT, 0), "left");
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_RIGHT, 0), "right");
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_UP, 0), "up");
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_DOWN, 0), "down");
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_A, 0), "left");
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_D, 0), "right");
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_W, 0), "up");
        im.put(KeyStroke.getKeyStroke(KeyEvent.VK_S, 0), "down");
        am.put("left", new AbstractAction() { public void actionPerformed(ActionEvent e) { moveLeft(); } });
        am.put("right", new AbstractAction() { public void actionPerformed(ActionEvent e) { moveRight(); } });
        am.put("up", new AbstractAction() { public void actionPerformed(ActionEvent e) { moveUp(); } });
        am.put("down", new AbstractAction() { public void actionPerformed(ActionEvent e) { moveDown(); } });

        pack();
        setLocationRelativeTo(null);
        startGameTimer();
    }

    /** 对手视图：名字、分数、4x4 小棋盘 */
    private static class OpponentView {
        String name;
        JLabel scoreLabel;
        JLabel[][] tiles = new JLabel[SIZE][SIZE];
    }

    private void initUI() {
        JPanel main = new JPanel(new BorderLayout());
        main.setBackground(BG);
        main.setPreferredSize(new Dimension(720, 580));

        // 顶部栏
        JPanel top = new JPanel(new BorderLayout());
        top.setBackground(BG);
        top.setBorder(BorderFactory.createEmptyBorder(10, 15, 5, 15));

        JLabel title = new JLabel("2048 对决");
        title.setFont(new Font("Microsoft YaHei", Font.BOLD, 20));
        title.setForeground(Color.WHITE);
        top.add(title, BorderLayout.WEST);

        JPanel infoPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 10, 0));
        infoPanel.setBackground(BG);

        scoreLabel = new JLabel("分数: 0");
        scoreLabel.setFont(new Font("Microsoft YaHei", Font.BOLD, 14));
        scoreLabel.setForeground(new Color(255, 200, 50));
        infoPanel.add(scoreLabel);

        timerLabel = new JLabel("03:00");
        timerLabel.setFont(new Font("Consolas", Font.BOLD, 16));
        timerLabel.setForeground(new Color(100, 255, 100));
        infoPanel.add(timerLabel);

        top.add(infoPanel, BorderLayout.EAST);
        main.add(top, BorderLayout.NORTH);

        // 中间：左侧自己的棋盘 + 右侧对手信息
        JPanel center = new JPanel(null); // 绝对定位，精确控制尺寸
        center.setBackground(BG);
        center.setPreferredSize(new Dimension(720, 480));

        // 左侧：自己的 2048 棋盘（固定 320x320，保证正方形格子）
        JPanel myBoardPanel = new JPanel(new BorderLayout());
        myBoardPanel.setBackground(BG);
        myBoardPanel.setBounds(20, 10, 320, 355);

        JLabel myLabel = new JLabel("我的棋盘", JLabel.CENTER);
        myLabel.setFont(new Font("Microsoft YaHei", Font.BOLD, 13));
        myLabel.setForeground(new Color(100, 200, 255));
        myBoardPanel.add(myLabel, BorderLayout.NORTH);

        gridPanel = new JPanel(new GridLayout(SIZE, SIZE, 4, 4));
        gridPanel.setBackground(GRID_BG);
        gridPanel.setBorder(BorderFactory.createEmptyBorder(4, 4, 4, 4));
        gridPanel.setPreferredSize(new Dimension(320, 320));
        gridPanel.setMaximumSize(new Dimension(320, 320));
        gridPanel.setMinimumSize(new Dimension(320, 320));

        tileLabels = new JLabel[SIZE][SIZE];
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                JLabel tile = new JLabel("", SwingConstants.CENTER);
                tile.setFont(new Font("Microsoft YaHei", Font.BOLD, 24));
                tile.setOpaque(true);
                tile.setBackground(CELL_BG);
                gridPanel.add(tile);
                tileLabels[r][c] = tile;
            }
        }
        myBoardPanel.add(gridPanel, BorderLayout.CENTER);
        center.add(myBoardPanel);

        // 右侧：对手面板（带滚动条）
        JPanel rightWrapper = new JPanel(new BorderLayout());
        rightWrapper.setBackground(BG);
        rightWrapper.setBounds(360, 10, 340, 460);

        JLabel oppTitle = new JLabel("对手局面", JLabel.CENTER);
        oppTitle.setFont(new Font("Microsoft YaHei", Font.BOLD, 14));
        oppTitle.setForeground(Color.WHITE);
        rightWrapper.add(oppTitle, BorderLayout.NORTH);

        JPanel oppContainer = new JPanel();
        oppContainer.setBackground(CARD_BG);
        oppContainer.setLayout(new BoxLayout(oppContainer, BoxLayout.Y_AXIS));
        oppContainer.setBorder(BorderFactory.createEmptyBorder(10, 12, 10, 12));

        for (String p : allPlayers) {
            if (p.equals(username)) continue;
            OpponentView ov = new OpponentView();
            ov.name = p;

            JPanel oppCard = new JPanel();
            oppCard.setBackground(CARD_BG);
            oppCard.setLayout(new BoxLayout(oppCard, BoxLayout.Y_AXIS));
            oppCard.setAlignmentX(Component.LEFT_ALIGNMENT);
            oppCard.setMaximumSize(new Dimension(300, 190));
            oppCard.setPreferredSize(new Dimension(300, 190));

            // 名字行
            JPanel nameRow = new JPanel(new BorderLayout());
            nameRow.setBackground(CARD_BG);
            nameRow.setMaximumSize(new Dimension(300, 24));

            JLabel nameLabel = new JLabel(p);
            nameLabel.setFont(new Font("Microsoft YaHei", Font.PLAIN, 13));
            nameLabel.setForeground(new Color(180, 183, 186));

            ov.scoreLabel = new JLabel("分数: —", SwingConstants.RIGHT);
            ov.scoreLabel.setFont(new Font("Microsoft YaHei", Font.BOLD, 13));
            ov.scoreLabel.setForeground(new Color(255, 200, 50));

            nameRow.add(nameLabel, BorderLayout.WEST);
            nameRow.add(ov.scoreLabel, BorderLayout.EAST);
            oppCard.add(nameRow);
            oppCard.add(Box.createVerticalStrut(6));

            // 4x4 小棋盘
            JPanel miniGrid = new JPanel(new GridLayout(SIZE, SIZE, 2, 2));
            miniGrid.setBackground(GRID_BG);
            miniGrid.setBorder(BorderFactory.createEmptyBorder(2, 2, 2, 2));
            miniGrid.setPreferredSize(new Dimension(120, 120));
            miniGrid.setMaximumSize(new Dimension(120, 120));
            miniGrid.setMinimumSize(new Dimension(120, 120));
            miniGrid.setAlignmentX(Component.LEFT_ALIGNMENT);

            for (int r = 0; r < SIZE; r++) {
                for (int c = 0; c < SIZE; c++) {
                    JLabel tile = new JLabel("", SwingConstants.CENTER);
                    tile.setFont(new Font("Microsoft YaHei", Font.BOLD, 10));
                    tile.setOpaque(true);
                    tile.setBackground(CELL_BG);
                    miniGrid.add(tile);
                    ov.tiles[r][c] = tile;
                }
            }
            oppCard.add(miniGrid);

            oppContainer.add(oppCard);
            oppContainer.add(Box.createVerticalStrut(12));
            opponentViews.put(p, ov);
        }

        JScrollPane scrollPane = new JScrollPane(oppContainer,
                ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        scrollPane.setBackground(BG);
        scrollPane.getViewport().setBackground(CARD_BG);
        scrollPane.setBorder(BorderFactory.createEmptyBorder());
        rightWrapper.add(scrollPane, BorderLayout.CENTER);
        center.add(rightWrapper);

        main.add(center, BorderLayout.CENTER);
        getContentPane().add(main);
    }

    private void initGame(long seed) {
        board = new int[SIZE][SIZE];
        score = 0;
        gameOver = false;
        Random rnd = new Random(seed);
        addRandomTile(rnd);
        addRandomTile(rnd);
        updateUI();
    }

    private void addRandomTile() {
        addRandomTile(new Random());
    }

    private void addRandomTile(Random rnd) {
        List<int[]> empty = new ArrayList<>();
        for (int r = 0; r < SIZE; r++)
            for (int c = 0; c < SIZE; c++)
                if (board[r][c] == 0) empty.add(new int[]{r, c});
        if (empty.isEmpty()) return;
        int[] pos = empty.get(rnd.nextInt(empty.size()));
        board[pos[0]][pos[1]] = (rnd.nextDouble() < 0.9) ? 2 : 4;
    }

    private void updateUI() {
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                int val = board[r][c];
                JLabel tile = tileLabels[r][c];
                tile.setText(val == 0 ? "" : String.valueOf(val));
                tile.setBackground(TILE_COLORS.getOrDefault(val, new Color(60, 58, 50)));
                if (val <= 4) tile.setForeground(new Color(119, 110, 101));
                else tile.setForeground(Color.WHITE);
                if (val >= 1024) tile.setFont(new Font("Microsoft YaHei", Font.BOLD, 18));
                else if (val >= 128) tile.setFont(new Font("Microsoft YaHei", Font.BOLD, 20));
                else tile.setFont(new Font("Microsoft YaHei", Font.BOLD, 24));
            }
        }
        scoreLabel.setText("分数: " + score);
    }

    // ===== 移动逻辑 =====

    private void moveLeft() {
        boolean moved = false;
        for (int r = 0; r < SIZE; r++) {
            int[] row = board[r].clone();
            int[] merged = compressLeft(row);
            for (int c = 0; c < SIZE; c++) {
                if (board[r][c] != merged[c]) moved = true;
                board[r][c] = merged[c];
            }
        }
        afterMove(moved);
    }

    private void moveRight() {
        boolean moved = false;
        for (int r = 0; r < SIZE; r++) {
            int[] row = board[r].clone();
            reverse(row);
            int[] merged = compressLeft(row);
            reverse(merged);
            for (int c = 0; c < SIZE; c++) {
                if (board[r][c] != merged[c]) moved = true;
                board[r][c] = merged[c];
            }
        }
        afterMove(moved);
    }

    private void moveUp() {
        boolean moved = false;
        for (int c = 0; c < SIZE; c++) {
            int[] col = new int[SIZE];
            for (int r = 0; r < SIZE; r++) col[r] = board[r][c];
            int[] merged = compressLeft(col);
            for (int r = 0; r < SIZE; r++) {
                if (board[r][c] != merged[r]) moved = true;
                board[r][c] = merged[r];
            }
        }
        afterMove(moved);
    }

    private void moveDown() {
        boolean moved = false;
        for (int c = 0; c < SIZE; c++) {
            int[] col = new int[SIZE];
            for (int r = 0; r < SIZE; r++) col[r] = board[r][c];
            reverse(col);
            int[] merged = compressLeft(col);
            reverse(merged);
            for (int r = 0; r < SIZE; r++) {
                if (board[r][c] != merged[r]) moved = true;
                board[r][c] = merged[r];
            }
        }
        afterMove(moved);
    }

    private int[] compressLeft(int[] row) {
        int[] result = new int[SIZE];
        int idx = 0;
        boolean lastMerged = false;
        for (int i = 0; i < SIZE; i++) {
            if (row[i] == 0) continue;
            if (idx > 0 && result[idx - 1] == row[i] && !lastMerged) {
                result[idx - 1] *= 2;
                score += result[idx - 1];
                lastMerged = true;
            } else {
                result[idx++] = row[i];
                lastMerged = false;
            }
        }
        return result;
    }

    private void reverse(int[] arr) {
        for (int i = 0; i < arr.length / 2; i++) {
            int tmp = arr[i];
            arr[i] = arr[arr.length - 1 - i];
            arr[arr.length - 1 - i] = tmp;
        }
    }

    private void afterMove(boolean moved) {
        if (!moved || gameOver || localFinished) return;
        addRandomTile();
        updateUI();
        syncBoard();

        if (isBoardFull()) {
            // 检查是否还能移动
            if (!canMove()) {
                // 棋盘满了且无法移动，提前结束
                finishGame("FAIL");
            }
        }
    }

    /** 把当前棋盘序列化为 "2,0,0,4,..."（按行优先 16 个数字） */
    private String serializeBoard() {
        StringBuilder sb = new StringBuilder();
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                if (sb.length() > 0) sb.append(",");
                sb.append(board[r][c]);
            }
        }
        return sb.toString();
    }

    /** 带节流地向服务器同步完整局面（最多每 600ms 一次） */
    private void syncBoard() {
        long now = System.currentTimeMillis();
        if (now - lastScoreSyncTime < 600) return;
        lastScoreSyncTime = now;
        final int sc = score;
        final String bd = serializeBoard();
        new Thread(() -> {
            ServerClient.duelGameBoard(roomId, username, sc, bd);
        }).start();
    }

    private boolean isBoardFull() {
        for (int r = 0; r < SIZE; r++)
            for (int c = 0; c < SIZE; c++)
                if (board[r][c] == 0) return false;
        return true;
    }

    private boolean canMove() {
        for (int r = 0; r < SIZE; r++)
            for (int c = 0; c < SIZE; c++) {
                if (board[r][c] == 0) return true;
                if (c < SIZE - 1 && board[r][c] == board[r][c + 1]) return true;
                if (r < SIZE - 1 && board[r][c] == board[r + 1][c]) return true;
            }
        return false;
    }

    // ===== 计时器 =====

    private void startGameTimer() {
        startTime = System.currentTimeMillis();
        timer = new javax.swing.Timer(200, e -> {
            if (gameOver || localFinished) return;
            long elapsed = System.currentTimeMillis() - startTime;
            long remaining = TIME_LIMIT_MS - elapsed;
            if (remaining <= 0) {
                timer.stop();
                finishGame("WIN");
            } else {
                long sec = remaining / 1000;
                timerLabel.setText(String.format("%02d:%02d", sec / 60, sec % 60));
                if (sec <= 30) timerLabel.setForeground(new Color(255, 100, 100));
            }
        });
        timer.start();
    }

    // ===== 结果处理 =====

    private void finishGame(String result) {
        if (localFinished) return;
        localFinished = true;
        if (timer != null) timer.stop();
        // 发送最终局面（不受节流限制）
        final int finalScore = score;
        final String finalBoard = serializeBoard();
        new Thread(() -> ServerClient.duelGameBoard(roomId, username, finalScore, finalBoard)).start();
        sendResult(result);
    }

    private void sendResult(String result) {
        long finishTime = System.currentTimeMillis() - startTime;
        new Thread(() -> {
            String resp = ServerClient.duelGameResult(roomId, username, result, finishTime, score);
            if (resp != null && resp.startsWith("SUCCESS|ALL_DONE|")) {
                String resultsData = resp.substring("SUCCESS|ALL_DONE|".length());
                SwingUtilities.invokeLater(() -> {
                    if (!resultDialogShown) handleGameOver(resultsData);
                });
            }
        }).start();
        startResultPolling();
    }

    private void startResultPolling() {
        if (resultPollTimer != null) resultPollTimer.stop();
        resultPollTimer = new javax.swing.Timer(1500, e -> {
            if (resultDialogShown) { resultPollTimer.stop(); return; }
            new Thread(() -> {
                String resp = ServerClient.duelGameResults(roomId);
                if (resp.startsWith("SUCCESS|ALL_DONE|")) {
                    String resultsData = resp.substring("SUCCESS|ALL_DONE|".length());
                    SwingUtilities.invokeLater(() -> {
                        if (!resultDialogShown) handleGameOver(resultsData);
                    });
                }
            }).start();
        });
        resultPollTimer.start();
    }

    /** 接收对手局面推送 */
    public static void receiveBoardPush(int roomId, String pushData) {
        Game2048DuelGame game = activeGames.get(roomId);
        if (game != null) {
            SwingUtilities.invokeLater(() -> game.handleBoardPush(pushData));
        }
    }

    private void handleBoardPush(String pushData) {
        // 格式: "username:score:boardData"，boardData 为 "2,0,0,4,..."
        int firstSep = pushData.indexOf(':');
        if (firstSep < 0) return;
        String oppName = pushData.substring(0, firstSep);

        int secondSep = pushData.indexOf(':', firstSep + 1);
        if (secondSep < 0) return;
        String scoreStr = pushData.substring(firstSep + 1, secondSep);
        String boardStr = pushData.substring(secondSep + 1);

        int oppScore;
        try { oppScore = Integer.parseInt(scoreStr); } catch (Exception e) { return; }

        OpponentView ov = opponentViews.get(oppName);
        if (ov == null) return;
        ov.scoreLabel.setText("分数: " + oppScore);

        String[] vals = boardStr.split(",");
        int idx = 0;
        for (int r = 0; r < SIZE && idx < vals.length; r++) {
            for (int c = 0; c < SIZE && idx < vals.length; c++, idx++) {
                int val = 0;
                try { val = Integer.parseInt(vals[idx].trim()); } catch (Exception e) {}
                JLabel tile = ov.tiles[r][c];
                tile.setText(val == 0 ? "" : String.valueOf(val));
                tile.setBackground(TILE_COLORS.getOrDefault(val, new Color(60, 58, 50)));
                if (val <= 4) tile.setForeground(new Color(119, 110, 101));
                else tile.setForeground(Color.WHITE);
            }
        }
    }

    /** 接收 ALL_DONE 推送 */
    public static void receiveAllDone(int roomId, String resultsData) {
        Game2048DuelGame game = activeGames.get(roomId);
        if (game != null && !game.resultDialogShown) {
            SwingUtilities.invokeLater(() -> game.handleGameOver(resultsData));
        }
    }

    private void handleGameOver(String resultsData) {
        if (resultDialogShown) return;
        resultDialogShown = true;
        if (timer != null) timer.stop();
        if (resultPollTimer != null) resultPollTimer.stop();
        gameOver = true;

        // 解析结果（与服务端一致）：用 ';' 分隔玩家，每个玩家为 "name,result:time:score"
        Map<String, int[]> playerScores = new LinkedHashMap<>(); // name -> [score]
        Map<String, String> rawResults = new LinkedHashMap<>();

        for (String entry : resultsData.split(";")) {
            String[] kv = entry.split(",", 2);
            if (kv.length == 2) {
                String name = kv[0];
                String[] rp = kv[1].split(":");
                String result = rp.length >= 1 ? rp[0] : "";
                long time = 0;
                int sc = 0;
                try { if (rp.length >= 2) time = Long.parseLong(rp[1]); } catch (Exception e) {}
                try { if (rp.length >= 3) sc = Integer.parseInt(rp[2]); } catch (Exception e) {}
                rawResults.put(name, result + ":" + time);
                playerScores.put(name, new int[]{sc});
            }
        }

        // 判定赢家：分数最高者；若最高分被多人并列，则判为平局
        String winner = null;
        int bestScore = -1;
        int bestCount = 0;
        for (Map.Entry<String, int[]> e : playerScores.entrySet()) {
            int s = e.getValue()[0];
            if (s > bestScore) {
                bestScore = s;
                winner = e.getKey();
                bestCount = 1;
            } else if (s == bestScore) {
                bestCount++;
            }
        }
        if (bestCount > 1) winner = null; // 平分 → 平局

        boolean iAmWinner = username.equals(winner);

        // 保存纪录
        Game2048Records.saveRec(userId, "经典模式", String.valueOf(score));

        showResultDialog(winner, playerScores, iAmWinner);
    }

    private void showResultDialog(String winner, Map<String, int[]> playerScores, boolean iAmWinner) {
        JDialog resultDialog = new JDialog(this, "游戏结束", true);
        resultDialog.setLayout(new BorderLayout());
        resultDialog.setSize(400, 360);
        resultDialog.setLocationRelativeTo(this);
        resultDialog.setResizable(false);
        resultDialog.setDefaultCloseOperation(JDialog.DO_NOTHING_ON_CLOSE);

        final int[] action = {0};

        JPanel content = new JPanel();
        content.setBackground(BG);
        content.setLayout(new BoxLayout(content, BoxLayout.Y_AXIS));
        content.setBorder(BorderFactory.createEmptyBorder(25, 30, 20, 30));

        String titleText;
        Color titleColor;
        if (winner == null) {
            titleText = "平局！";
            titleColor = new Color(220, 150, 50);
        } else if (iAmWinner) {
            titleText = "YOU WIN!";
            titleColor = new Color(50, 220, 50);
        } else {
            titleText = "YOU LOSE!";
            titleColor = new Color(220, 50, 50);
        }

        JLabel bigLabel = new JLabel(titleText, JLabel.CENTER);
        bigLabel.setFont(new Font("Microsoft YaHei", Font.BOLD, 36));
        bigLabel.setForeground(titleColor);
        bigLabel.setAlignmentX(Component.CENTER_ALIGNMENT);
        content.add(bigLabel);
        content.add(Box.createVerticalStrut(15));

        // 排名（按分数降序）
        List<Map.Entry<String, int[]>> sorted = new ArrayList<>(playerScores.entrySet());
        sorted.sort((a, b) -> b.getValue()[0] - a.getValue()[0]);

        int rank = 1;
        for (Map.Entry<String, int[]> e : sorted) {
            JPanel row = new JPanel(new BorderLayout());
            row.setBackground(BG);
            row.setMaximumSize(new Dimension(320, 25));

            JLabel rankLabel = new JLabel("#" + rank + "  " + e.getKey());
            rankLabel.setFont(new Font("Microsoft YaHei", Font.BOLD, 14));
            rankLabel.setForeground(e.getKey().equals(winner) ? new Color(255, 215, 0) : Color.WHITE);

            JLabel scLabel = new JLabel(String.valueOf(e.getValue()[0]) + " 分", SwingConstants.RIGHT);
            scLabel.setFont(new Font("Microsoft YaHei", Font.BOLD, 14));
            scLabel.setForeground(new Color(255, 200, 50));

            row.add(rankLabel, BorderLayout.WEST);
            row.add(scLabel, BorderLayout.EAST);
            content.add(row);
            content.add(Box.createVerticalStrut(5));
            rank++;
        }

        content.add(Box.createVerticalStrut(15));

        // 按钮
        JPanel btnRow = new JPanel(new FlowLayout(FlowLayout.CENTER, 15, 0));
        btnRow.setBackground(BG);

        JButton homeBtn = new JButton("回到主页");
        homeBtn.setFont(new Font("Microsoft YaHei", Font.BOLD, 14));
        homeBtn.setForeground(Color.WHITE);
        homeBtn.setBackground(new Color(0, 120, 215));
        homeBtn.setFocusPainted(false);
        homeBtn.setBorder(BorderFactory.createEmptyBorder(10, 20, 10, 20));
        homeBtn.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        homeBtn.addActionListener(e -> { action[0] = 1; resultDialog.dispose(); });

        JButton roomBtn = new JButton("回到房间");
        roomBtn.setFont(new Font("Microsoft YaHei", Font.BOLD, 14));
        roomBtn.setForeground(Color.WHITE);
        roomBtn.setBackground(new Color(80, 83, 86));
        roomBtn.setFocusPainted(false);
        roomBtn.setBorder(BorderFactory.createEmptyBorder(10, 20, 10, 20));
        roomBtn.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        roomBtn.addActionListener(e -> { action[0] = 2; resultDialog.dispose(); });

        btnRow.add(homeBtn);
        btnRow.add(roomBtn);
        content.add(btnRow);

        resultDialog.add(content, BorderLayout.CENTER);
        resultDialog.setVisible(true);

        // 对话框关闭后
        activeGames.remove(roomId);
        MessageCenter.disposeActive();
        switch (action[0]) {
            case 1: // 回到主页
                if (parentRoom != null) parentRoom.dispose();
                dispose();
                FishGrabbingHome.showActiveInstance();
                break;
            case 2: // 回到房间
            default:
                returnToRoom();
                break;
        }
    }

    private void returnToRoom() {
        dispose();
        if (parentRoom != null) {
            if (parentRoom instanceof Game2048MatchRoom) {
                ((Game2048MatchRoom) parentRoom).resetForNewGame();
            }
            parentRoom.setVisible(true);
            parentRoom.setLocationRelativeTo(null);
        }
    }
}
