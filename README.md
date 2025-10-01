# SoundCloud MP3 Proxy


## Особливості
- **Кілька плейлистів**: Додавайте через `?playlists=https://url1|https://url2`.
- **Loop**: `&loop=true` (за замовчуванням) для нескінченного відтворення.


## Швидкий деплой на Railway.app
[![Deploy to Railway](https://railway.app/button.svg)](https://railway.app/new?template=https://github.com/OleksandrDernoviy/AlexSoundProxy)

1. Натисніть кнопку вище.
2. Після деплою отримайте URL:  
https://alexsoundproxy-production.up.railway.app/stream?playlists=https://on.soundcloud.com/uTx5qT8hwIkrxKVvBB&loop=true

Додавання інших плейлистів

Додайте URL через |, наприклад:

https://alexsoundproxy-production.up.railway.app/stream?playlists=https://url1|https://url2&loop=true

Локальний тест

npm install
npm start

Відкрийте: http://localhost:3000/stream?playlists=https://on.soundcloud.com/uTx5qT8hwIkrxKVvBB.

Обмеження
Тільки публічні плейлисти.
Railway засинає після 30 хв без трафіку (пінгуйте для активності).

Ліцензія

MIT. Використовуйте для особистих цілей.

Базується на node-soundcloud-downloader.