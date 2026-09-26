# School Navigator Template

汎用的な校内ナビゲーションのテンプレートです。実在の学校名、校舎画像、教室名、座標、イベント情報、人物画像は含めていません。

## セットアップ

Node.js をインストールしたあと、依存関係をインストールします。

```sh
npm install
```

## 環境データの設定

実際に利用するデータは `env/` に配置します。

- `env/manifest.js`: PWAの表示名
- `env/mapinfo.js`: 階層、部屋名、検索語、座標
- `env/map/*.svg`: 各階の地図画像

`npm run dev` または `npm run build` の実行時に、`env/` の内容が生成先の `public/env/` へコピーされます。`public/env/` は生成物なのでGitへ登録しません。

```sh
npm run dev
npm run build
```

`env/` に個人情報、学校固有の機密情報、許諾のない画像やイベント情報を追加しないでください。公開する場合は、画像の著作権・肖像権・施設情報の公開許可を確認してください。

## Cloudflare Pages

`functions/_middleware.js` は、任意で設定したCloudflare Pages Secret（`SITE_ACCESS_TOKEN`）によるHTML本体のアクセス制御例です。URLクエリに含める共有値は厳密な認証や機密データ保護には使わないでください。機密性が必要な場合は、認証セッションや署名付きURLを導入してください。

## デバッグ

通常は `src/debug.js` の `debug` を `false` のまま使用してください。

