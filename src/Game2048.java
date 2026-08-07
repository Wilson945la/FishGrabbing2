import javax.swing.*;
import java.awt.*;
import java.awt.event.*;
import java.util.*;

/**
 * 2048 经典模式
 * 4x4 网格，方向键/WASD 控制，相同数字合并，目标 2048
 */
public class Game2048 extends JFrame {

    private static final int SIZE = 4;
    private static final Color BG = new Color(50, 53, 56);
    private static final Color GRID_BG = new Color(60, 63, 65);
    private static final Color CELL_BG = new Color(70, 73, 76);

    // 数字方块颜色
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

    private int[][] board = new int[SIZE][SIZE];
    private int score = 0;
    private int bestScore = 0;
    private boolean gameOver = false;
    private boolean won = false;

    private JLabel scoreLabel;
    private JLabel bestLabel;
    private JPanel gridPanel;
    private JLabel[][] tileLabels;

    private JFrame homeFrame;
    private int userId;

    public void setHomeFrame(JFrame homeFrame) { this.homeFrame = homeFrame; }

    public Game2048(int userId) {
        this.userId = userId;
        this.bestScore = Game2048Records.loadBestScore(userId);

        setTitle("2048");
        setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        setResizable(false);

        addWindowListener(new WindowAdapter() {
            public void windowClosing(WindowEvent e) {
                if (homeFrame != null && homeFrame.isDisplayable()) {
                    homeFrame.setVisible(true);
                    homeFrame.setLocationRelativeTo(null);
                } else {
                    FishGrabbingHome.showActiveInstance();
                }
            }
        });

        initUI();
        initGame();

        // 键盘控制
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
    }

    private void initUI() {
        JPanel main = new JPanel(new BorderLayout());
        main.setBackground(BG);
        main.setPreferredSize(new Dimension(380, 560));

        // 顶部：标题 + 分数
        JPanel top = new JPanel(new BorderLayout());
        top.setBackground(BG);
        top.setBorder(BorderFactory.createEmptyBorder(15, 15, 10, 15));

        JLabel title = new JLabel("2048");
        title.setFont(new Font("Microsoft YaHei", Font.BOLD, 28));
        title.setForeground(Color.WHITE);

        JPanel scorePanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 5, 0));
        scorePanel.setBackground(BG);

        JPanel scoreBox = createScoreBox("分数", String.valueOf(score));
        scoreLabel = (JLabel) scoreBox.getClientProperty("label");
        JPanel bestBox = createScoreBox("最高", String.valueOf(bestScore));
        bestLabel = (JLabel) bestBox.getClientProperty("label");

        scorePanel.add(scoreBox);
        scorePanel.add(bestBox);

        top.add(title, BorderLayout.WEST);
        top.add(scorePanel, BorderLayout.EAST);
        main.add(top, BorderLayout.NORTH);

        // 提示文字
        JPanel hintPanel = new JPanel(new FlowLayout(FlowLayout.LEFT, 15, 0));
        hintPanel.setBackground(BG);
        JLabel hint = new JLabel("方向键/WASD 移动 · 合并相同数字");
        hint.setFont(new Font("Microsoft YaHei", Font.PLAIN, 11));
        hint.setForeground(new Color(150, 153, 156));
        hintPanel.add(hint);
        main.add(hintPanel, BorderLayout.SOUTH);

        // 中间：4x4 网格
        gridPanel = new JPanel(new GridLayout(SIZE, SIZE, 6, 6));
        gridPanel.setBackground(GRID_BG);
        gridPanel.setBorder(BorderFactory.createEmptyBorder(6, 6, 6, 6));
        gridPanel.setPreferredSize(new Dimension(340, 340));

        tileLabels = new JLabel[SIZE][SIZE];
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                JLabel tile = new JLabel("", SwingConstants.CENTER);
                tile.setFont(new Font("Microsoft YaHei", Font.BOLD, 28));
                tile.setOpaque(true);
                tile.setBackground(CELL_BG);
                gridPanel.add(tile);
                tileLabels[r][c] = tile;
            }
        }

        JPanel gridWrap = new JPanel(new FlowLayout(FlowLayout.CENTER, 0, 0));
        gridWrap.setBackground(BG);
        gridWrap.setBorder(BorderFactory.createEmptyBorder(5, 15, 15, 15));
        gridWrap.add(gridPanel);
        main.add(gridWrap, BorderLayout.CENTER);

        // 底部按钮
        JPanel bot = new JPanel(new FlowLayout(FlowLayout.CENTER, 10, 5));
        bot.setBackground(BG);
        JButton newGameBtn = new JButton("新游戏");
        newGameBtn.setFont(new Font("Microsoft YaHei", Font.BOLD, 14));
        newGameBtn.setForeground(Color.WHITE);
        newGameBtn.setBackground(new Color(0, 120, 215));
        newGameBtn.setFocusPainted(false);
        newGameBtn.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        newGameBtn.addActionListener(e -> initGame());
        bot.add(newGameBtn);

        JButton backBtn = new JButton("返回");
        backBtn.setFont(new Font("Microsoft YaHei", Font.BOLD, 14));
        backBtn.setForeground(Color.WHITE);
        backBtn.setBackground(new Color(80, 83, 86));
        backBtn.setFocusPainted(false);
        backBtn.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        backBtn.addActionListener(e -> {
            dispose();
            if (homeFrame != null && homeFrame.isDisplayable()) {
                homeFrame.setVisible(true);
                homeFrame.setLocationRelativeTo(null);
            } else {
                FishGrabbingHome.showActiveInstance();
            }
        });
        bot.add(backBtn);
        main.add(bot, BorderLayout.SOUTH);

        getContentPane().add(main);
    }

    private JPanel createScoreBox(String title, String value) {
        JPanel box = new JPanel();
        box.setLayout(new BoxLayout(box, BoxLayout.Y_AXIS));
        box.setBackground(new Color(60, 63, 65));
        box.setBorder(BorderFactory.createEmptyBorder(5, 12, 5, 12));
        box.setPreferredSize(new Dimension(70, 48));

        JLabel t = new JLabel(title, SwingConstants.CENTER);
        t.setFont(new Font("Microsoft YaHei", Font.PLAIN, 10));
        t.setForeground(new Color(150, 153, 156));
        t.setAlignmentX(Component.CENTER_ALIGNMENT);

        JLabel v = new JLabel(value, SwingConstants.CENTER);
        v.setFont(new Font("Microsoft YaHei", Font.BOLD, 16));
        v.setForeground(Color.WHITE);
        v.setAlignmentX(Component.CENTER_ALIGNMENT);

        box.add(t);
        box.add(v);
        box.putClientProperty("label", v);
        return box;
    }

    private void initGame() {
        board = new int[SIZE][SIZE];
        score = 0;
        gameOver = false;
        won = false;
        addRandomTile();
        addRandomTile();
        updateUI();
    }

    private void addRandomTile() {
        java.util.List<int[]> empty = new ArrayList<>();
        for (int r = 0; r < SIZE; r++)
            for (int c = 0; c < SIZE; c++)
                if (board[r][c] == 0) empty.add(new int[]{r, c});
        if (empty.isEmpty()) return;
        int[] pos = empty.get(new Random().nextInt(empty.size()));
        board[pos[0]][pos[1]] = (new Random().nextDouble() < 0.9) ? 2 : 4;
    }

    private void updateUI() {
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                int val = board[r][c];
                JLabel tile = tileLabels[r][c];
                tile.setText(val == 0 ? "" : String.valueOf(val));
                tile.setBackground(TILE_COLORS.getOrDefault(val, new Color(60, 58, 50)));
                // 文字颜色：深色背景用深色文字，浅色背景用深色文字，大数字用白色
                if (val <= 4) {
                    tile.setForeground(new Color(119, 110, 101));
                } else {
                    tile.setForeground(Color.WHITE);
                }
                // 字体大小自适应
                if (val >= 1024) tile.setFont(new Font("Microsoft YaHei", Font.BOLD, 22));
                else if (val >= 128) tile.setFont(new Font("Microsoft YaHei", Font.BOLD, 24));
                else tile.setFont(new Font("Microsoft YaHei", Font.BOLD, 28));
            }
        }
        scoreLabel.setText(String.valueOf(score));
        if (score > bestScore) {
            bestScore = score;
            bestLabel.setText(String.valueOf(bestScore));
        }
    }

    // ===== 移动逻辑 =====

    private boolean moveLeft() {
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
        return moved;
    }

    private boolean moveRight() {
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
        return moved;
    }

    private boolean moveUp() {
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
        return moved;
    }

    private boolean moveDown() {
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
        return moved;
    }

    /** 向左压缩并合并 */
    private int[] compressLeft(int[] row) {
        int[] result = new int[SIZE];
        int idx = 0;
        boolean lastMerged = false;
        for (int i = 0; i < SIZE; i++) {
            if (row[i] == 0) continue;
            if (idx > 0 && result[idx - 1] == row[i] && !lastMerged) {
                result[idx - 1] *= 2;
                score += result[idx - 1];
                if (result[idx - 1] == 2048) won = true;
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
        if (!moved) return;
        addRandomTile();
        updateUI();

        if (won && !gameOver) {
            gameOver = true;
            int choice = JOptionPane.showConfirmDialog(this,
                "恭喜达成 2048！\n是否继续游戏？", "胜利！",
                JOptionPane.YES_NO_OPTION, JOptionPane.INFORMATION_MESSAGE);
            if (choice == JOptionPane.YES_OPTION) {
                gameOver = false;
            } else {
                saveAndExit();
            }
            return;
        }

        if (isGameOver()) {
            gameOver = true;
            saveAndExit();
            JOptionPane.showMessageDialog(this,
                "游戏结束！\n最终分数：" + score, "游戏结束",
                JOptionPane.INFORMATION_MESSAGE);
        }
    }

    private boolean isGameOver() {
        // 有空格则未结束
        for (int r = 0; r < SIZE; r++)
            for (int c = 0; c < SIZE; c++)
                if (board[r][c] == 0) return false;
        // 检查相邻是否可合并
        for (int r = 0; r < SIZE; r++)
            for (int c = 0; c < SIZE; c++) {
                if (c < SIZE - 1 && board[r][c] == board[r][c + 1]) return false;
                if (r < SIZE - 1 && board[r][c] == board[r + 1][c]) return false;
            }
        return true;
    }

    private void saveAndExit() {
        Game2048Records.saveRec(userId, "经典模式", String.valueOf(score));
    }

    public static void main(String[] args) {
        System.setProperty("sun.java2d.dpiaware", "true");
        System.setProperty("sun.java2d.uiScale", "1.0");
        SwingUtilities.invokeLater(() -> new Game2048(0).setVisible(true));
    }
}
