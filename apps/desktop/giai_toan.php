<?php
$result = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $a = floatval($_POST['a'] ?? 0);
    $b = floatval($_POST['b'] ?? 0);
    $op = $_POST['op'] ?? '+';
    switch ($op) {
        case '+': $result = $a + $b; break;
        case '-': $result = $a - $b; break;
        case '*': $result = $a * $b; break;
        case '/': $result = $b != 0 ? $a / $b : 'Lỗi: chia cho 0'; break;
        default: $result = 'Toán tử không hợp lệ';
    }
}
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Giải Toán</title>
</head>
<body>
    <h2>Giải Toán</h2>
    <form method="post">
        <input type="number" step="any" name="a" placeholder="Số a" required>
        <select name="op">
            <option value="+">+</option>
            <option value="-">-</option>
            <option value="*">×</option>
            <option value="/">÷</option>
        </select>
        <input type="number" step="any" name="b" placeholder="Số b" required>
        <button type="submit">Giải</button>
    </form>
    <?php if ($result !== ''): ?>
        <p>Kết quả: <strong><?= htmlspecialchars($result) ?></strong></p>
    <?php endif; ?>
</body>
</html>