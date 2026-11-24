// Jasmine Widgets: 表示の言語（英語 / 日本語）。設定キー language: auto（GNOME の言語に合わせる）/ en / ja。
// カードの上の短いラベル（CPU / RAM、Sign in、状態など）は言語に関係なく英語のまま（JA に入れない）。
// 文章（設定画面・通知・エラー・メニュー・ツールチップ）は英語をそのままキーにして、日本語のときだけ JA の訳を返す。{0} {1} は _f の引数で置き換える。
// 拡張・設定画面・Web パネルのプロセスのどれからも使う（GLib 以外に依存しない）。
import GLib from 'gi://GLib';

let lang = 'en';

// value: 'auto' | 'en' | 'ja'
export function setLang(value) {
    if (value === 'en' || value === 'ja')
        lang = value;
    else
        lang = GLib.get_language_names().some(l => l.startsWith('ja')) ? 'ja' : 'en';
    return lang;
}

export function getLang() {
    return lang;
}

export function _(s) {
    return (lang === 'ja' && JA[s]) || s;
}

export function _f(s, ...args) {
    return _(s).replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ''));
}

const JA = {
    // カード・クイック設定
    'Launcher': 'ランチャー', 'Music': '音楽', 'System': 'システム', 'Clean RAM': 'メモリ整理', 'Web': 'Web パネル',
    'Jasmine': 'Jasmine', 'Widgets': 'ウィジェット', 'Cards': '表示するカード', 'Bring to front': 'カードを前に出す', 'Settings': '設定',
    'Browser': 'ブラウザ', 'Couldn’t open {0}': '{0} を開けませんでした',
    'Tablet mode': 'タブレットモード',                     'Couldn’t start': '起動できませんでした',
    '{0} not found': '{0} が見つかりません', 'Couldn’t open a terminal': 'ターミナルを起動できませんでした',
    'No accelerometer found — auto-rotate is unavailable': '傾きセンサーが見つからないため、自動回転は使えません',
    // ランチャー
    'Lock screen': '画面をロック', 'Suspend': 'スリープ', 'Log out…': 'ログアウト…', 'Restart…': '再起動…', 'Power off…': 'シャットダウン…',
    'Ask Claude: {0}': 'Claude に頼む: {0}', 'Open Claude Code': 'Claude Code を開く', 'New session': '新しいセッション',
    'Send to {0}: {1}': '{0} に送る: {1}', 'Open {0}': '{0} を開く', 'Pastes only — you press send': '貼り付けまで（送信は自分で）',
    'Search the web: {0}': 'Web で検索: {0}', 'Open: {0}': '開く: {0}', 'Enter to copy': 'Enter でコピー', 'Copied': 'コピーしました',
    '↑↓ select    Enter open    Esc close    ? web    > AI': '↑↓ 選ぶ    Enter 開く    Esc 閉じる    ? Web    > AI',
    '↑↓ select    Enter open    Esc close    ? web    > AI    @ {0}': '↑↓ 選ぶ    Enter 開く    Esc 閉じる    ? Web    > AI    @ {0}',
    // Parsec
            'Please sign in': 'ログインしてください', 'Please sign in again': 'ログインし直してください',
    'Couldn’t load ({0})': '取得できませんでした（{0}）', 'Couldn’t load': '取得できませんでした',
    'Enter your email and password': 'メールアドレスとパスワードを入力してください',     'Couldn’t sign in (network error)': 'ログインできませんでした（通信エラー）',
    'Enter your 2FA code and sign in again': '2段階認証コードを入れて、もう一度ログインしてください',
    'Couldn’t sign in ({0})': 'ログインできませんでした（{0}）', 'Couldn’t save to the keyring': 'キーリングに保存できませんでした',
    // Paseo・Muse
    'Starting in Paseo…': 'Paseo で始めています…', 'Couldn’t start in Paseo — opening a terminal': 'Paseo で始められなかったのでターミナルで開きます',
    'No sessions (type > in the launcher)': '会話はありません（ランチャーで > ）', 'Paseo isn’t installed': 'Paseo が入っていません',
    'Starting — paste with Ctrl+V': '起動しています。入力欄で Ctrl+V で貼り付けてください', 'Paste with Ctrl+V': 'Ctrl+V で貼り付けてください',
    // Web パネル
    'Remove “{0}”': '「{0}」を削除', 'Add site': 'サイトを追加', 'Name (e.g. Wikipedia)': '名前（例: Wikipedia）', 'URL (e.g. wikipedia.org)': 'URL（例: wikipedia.org）',
    'Add': '追加', 'Size (click or scroll)': '大きさ（押す・ホイールで切り替え）', 'Panes (click or scroll)': 'ページ数（押す・ホイールで切り替え）',
    'Reload': '再読み込み', 'Open in browser': 'ブラウザで開く',
    // 設定画面
    'Language': '言語', 'Automatic': '自動（GNOME に合わせる）', 'Reopen settings to apply here': '設定画面は開き直すと切り替わります',
    'Use theme color': 'テーマの色に戻す', 'Theme color': 'テーマの色', 'Not set': '未設定', 'Change': '変更',
    'Press the new key combination\nEsc to cancel, Backspace to clear': '登録したいキーの組み合わせを押してください\nEsc で取り消し、Backspace でショートカットを解除',
    'Cancel': '取り消し', 'Layout': '配置', 'Position & size': '位置と大きさ', 'Default': '基本位置',
    'Top right': '右上', 'Top left': '左上', 'Bottom right': '右下', 'Bottom left': '左下',
    'Cards set to “Default” stack from this corner': '「表示するカード」で場所を「基本位置」にしたカードが、ここから縦に並びます',
    'Drag to move': 'ドラッグで移動',
    'Drop near a screen edge to snap into that corner; anywhere else stays free': 'カードの余白をつかんで動かせます。画面の左右の端に落とすとその角の列に入り、ほかの場所なら「自由」になります',
    'Reset card positions': 'カードの位置をリセット', 'Move every card back to Default': '全カードを「基本位置」に戻します', 'Reset': 'リセット',
    'Width': '幅', 'Height': '高さ', 'Screen margin': '画面端からの余白', 'Card spacing': 'カード同士の間隔',
    'Reorder with the arrows; toggle visibility (also in Quick Settings → Jasmine)': '矢印で並べ替え、スイッチで表示／非表示（右上のクイック設定の「Jasmine」からも切り替えられます）',
    'Show cards': 'カードを表示', 'Hide everything when off': 'オフにすると全部隠します', 'Free': '自由',
    'Drag the card to set its free position': 'カードをドラッグして置いた場所が「自由」の位置になります',
    'Appearance': '見た目', 'Card': 'カード', 'Dark': 'ダーク', 'Light': 'ライト', 'Frosted': 'すりガラス', 'Mono': 'モノクロ',
    'Presets': 'プリセット', 'Apply a set of colors (fine-tune below)': '押すとまとめて切り替え（あとで個別に調整できます）',
    'Color': '色', 'Theme': 'テーマ', 'Follow GNOME': 'GNOME に合わせる', 'Background': 'カードの背景色', 'Text': 'カードの文字色',
    'Follow GNOME accent': 'アクセントを GNOME に合わせる', 'Use the accent color from GNOME Settings': 'GNOME の設定（外観）のアクセントカラーを使う',
    'Opacity': '不透明度', '0 = transparent, 1 = solid': '0 = 透明 / 1 = 不透明', 'Corner radius': '角の丸み', 'Text size': '文字の大きさ', '×': '倍率',
    'Shadow': '影をつける', 'Accent': 'アクセント（ボタン・リングの色）', 'Content': '中身',
    '? web search · > AI (Paseo / Claude Code) · @ quick-send · math': 'どこでもショートカットで開けます。? で Web 検索、> で AI（Paseo / Claude Code）、@ でクイック送信、数式で計算',
    'Quick-send app (@ prefix, .desktop ID)': '@ クイック送信先アプリ（.desktop の ID、空で無効）',
    'Working directory (for > AI)': '作業フォルダ（> AI 実行時、空でホーム）',
    'Show all MPRIS players': 'すべての MPRIS プレーヤーを表示', 'When off, only dedicated music players are shown': 'オフのときは音楽プレーヤー系だけを表示',
    'App to open on click (.desktop ID, empty = auto)': 'カードを押したときに開くアプリ（.desktop の ID、空で自動）',
    'Shortcut': 'ランチャーを開くショートカット', 'Popup width': 'ポップアップの幅', 'Popup position': 'ポップアップの縦の位置', '% from top': '画面の上から %',
    'Small browser panes. Add sites with +, right-click a site to remove': 'カードに重ねて表示する小さなブラウザ。サイトはパネルの＋で追加、アイコンを右クリックで削除',
    'Panes': 'ページ数', 'Side by side (also the pane button on the panel)': '横に並べる数（パネルのバーのボタンでも切り替え）',
    'Sleep when hidden': '隠れているときの休止', 'Minutes fully covered before unloading (0 = never)': '分（ウィンドウに完全に隠れてからページを閉じてメモリを空けるまで。0 = 休止しない）',
    'Search engine': '検索エンジン', 'Custom': 'カスタム', 'Custom search URL (%s = query)': 'カスタム検索 URL（%s が検索語）',
    'Hidden PCs (comma-separated)': '一覧に出さない PC（カンマ区切り）', 'Rows before scrolling': 'スクロールなしで表示する台数',
    'Sign out of Parsec': 'Parsec からログアウト', 'Remove the saved session from the keyring': 'キーリングに保存したセッションを削除します', 'Remove': '削除',
    'Removed (press ⟳ on the card)': '削除しました（カードの ⟳ で反映）', 'Couldn’t remove: {0}': '削除できませんでした: {0}',
    'Artwork size': 'ジャケットの大きさ', 'Sessions shown': '表示する会話の数',
    'The button quits background apps with no windows and reloads the web panes. Minimized apps are kept': 'ボタンを押すと、ウィンドウを開いていないのに裏で動き続けているアプリを閉じ、Web パネルを開き直します。最小化しているアプリは閉じません',
    'Apps to keep (.desktop IDs, comma-separated)': '閉じないアプリ（.desktop の ID、カンマ区切り）', 'Update interval': '更新の間隔', 'Seconds': '秒（短いほど細かく、少しだけ電池を使う）',
    'Controls': '操作', 'Three-finger swipe down to minimize': '3 本指で下へスワイプして最小化', 'Touchpad, outside the overview': 'タッチパッド。概要画面が出ていないときだけ',
    'Tablet mode button in the top bar': 'タブレットモードのボタンを上のバーに出す', 'Auto-rotate + on-screen keyboard': 'オンで自動回転＋画面キーボード',
    'Keyboard': 'キーボード', 'Floating keyboard in tablet mode': 'タブレットモードでフローティングキーボードを使う',
    'Replaces the GNOME on-screen keyboard. Drag the top bar to move it': 'GNOME の画面キーボードの代わりに使います。上のバーをドラッグすると動かせます',
    'Bring-to-front shortcut': 'ウィジェットを前に出すショートカット', 'Tablet mode shortcut': 'タブレットモードを切り替えるショートカット',
};
