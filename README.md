# School Navigator Template

汎用的な校内ナビゲーションのテンプレートです。実在の学校名、校舎画像、教室名、座標、イベント情報、人物画像は含めていません。  
Example: https://school-navigator-template.pages.dev/

## セットアップ

Node.js をインストールしたあと、依存関係をインストールします。

```sh
npm install
```

## 環境データの設定

実際に利用するデータは `env/` に配置します。

- `env/manifest.js`: PWAの表示名 (任意)
- `env/mapinfo.js`: 階層、部屋名、検索語、座標  ※部屋の前に始点・終点を表す座標も登録します。
- `env/map/*.svg`: 各階の地図画像

`npm run dev` または `npm run build` の実行時に、`env/` の内容が生成先の `public/env/` へコピーされます。`public/env/` は生成物なのでGitへ登録しません。

```sh
npm run dev
npm run build
```

`env/` に個人情報、学校固有の機密情報、許諾のない画像やイベント情報を追加しないでください。公開する場合は、画像の著作権・肖像権・施設情報の公開許可を確認してください。

## Cloudflare Pages
ビルドするときの設定があります。  
ビルドコマンド： `npm run build`  
ビルド出力： `dist`  


## デバッグツール
`src/debug.ts`の変数`debug`が`true`の際、デバッグモードとして以下の変更が行われます。
- マップ上で、`env/mapinfo.js`に用いる部屋情報を取得する機能
  - マップの右下をShift左クリック、次に左上をShift左クリックすると位置情報を含んだ`RoomInfo`オブジェクトがクリップボードにコピーされます。
  - `Alt`左クリックすると、その位置を`lineDot`としてクリップボードにコピーできます。
    `lineDot`が設定された部屋は、経路の点線がその座標から始まります。

## ライセンス
このプロジェクトは https://github.com/manmen2414/digitalpamphlet-htbs26/ をベースに開発されました。  
Copyright (c) 2026 mameeenn,maxgroup
