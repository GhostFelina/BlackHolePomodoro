# 🕳 Kara Delik Odak

Menü çubuğunda yaşayan bir macOS odak zamanlayıcısı. 50 dakika çalışırsın;
45. dakikada ekranında küçük bir **kara delik** doğar, 5 dakika boyunca
büyüyüp gezinerek etrafındaki **gerçek ekran içeriğini kütle çekimsel
merceklenmeyle büker** ve 50. dakikada ekranı tamamen yutar. 10 dakikalık
mola boyunca ekran karanlıktır; mola bitince kara delik büzülüp kaybolur ve
yeni tur otomatik başlar.

İlham: bir Ukraynalı geliştiricinin Ghostty terminali için yazdığı
`blackhole.glsl` shader'ı — bu proje aynı fikri terminalden çıkarıp
**tüm macOS ekranına** taşır.

## Kurulum

```bash
./build.sh install   # derler, paketler, /Applications'a kopyalar
open "/Applications/Kara Delik Odak.app"
```

Menü çubuğundaki 🕳 ikonundan **Başlat**'a bas. İlk başlatmada macOS
**Ekran Kaydı** izni isteyecek (gerçek merceklenme efekti için):
*Sistem Ayarları → Gizlilik ve Güvenlik → Ekran Kaydı* → "Kara Delik Odak"ı aç.
İzin vermezsen uygulama yine çalışır; kara delik stilize modda çizilir
(arka plan bükülmeden, sadece ışık halkasıyla).

> Not: `./build.sh` ile yeniden derlersen imza değiştiği için macOS izni
> tekrar isteyebilir — normaldir, bir kez daha onaylaman yeterli.

## Kullanım

| Menü | İşlev |
|---|---|
| Başlat / Durdur | Döngüyü başlatır/durdurur |
| Şimdi Mola Ver | Doğrudan mola fazına atlar |
| Molayı Atla | Molayı bitirip yeni tur başlatır |
| Süreler | 50+10 / 25+5 / 90+15 hazır düzenleri |
| 🧪 Hızlı Test Modu | Tüm süreler 60× hızlanır (50 dk → 50 sn) — efekti hemen görmek için |
| Girişte Başlat | Oturum açılınca uygulama otomatik açılır |

Mola ekranındaki "Molayı atla" düğmesi kasten zor ulaşılırdır: mola
başladıktan **6 saniye sonra** belirir ve **iki kez** basmanı ister
("Emin misin?"). Kazara tek bir tıklama molayı iptal edemez — bu davranış
gerçek bir hatanın düzeltilmesiyle eklendi (ekran kararırken imlecin altına
düşen tek tık molayı anında bitiriyordu).

## Bilinen sınırlar

- v1 yalnızca **ana ekranı** kaplar. Harici monitörün varsa oradan çalışmaya
  devam edebilirsin.
- Tam ekran (fullscreen) uygulamaların bazıları kendi Space'inde overlay'i
  üstlemeyebilir.

## Mimari

```
Sources/KaraDelikOdak/
├── main.swift               # NSApplication + AppDelegate, --selftest/--fast/--autostart
├── FocusEngine.swift        # Durum makinesi: working→warning→break, duvar saati tabanlı
├── StatusBarController.swift# Menü çubuğu arayüzü
├── OverlayController.swift  # Tam ekran overlay + animasyon koreografisi
├── BlackHoleRenderer.swift  # Metal renderer + merceklenme shader'ı (çalışma anında derlenir)
└── ScreenCapturer.swift     # ScreenCaptureKit → Metal dokusu (kendi penceresi hariç)
```

Tasarım notları:

- **Zaman asla tik biriktirerek sayılmaz** — her tikte duvar saatinden
  hesaplanır; Mac uyusa bile faz kayması olmaz.
- **Uyarı fazında pencere tıklamaları alta geçirir** (`ignoresMouseEvents`),
  çalışmana engel olmaz. Mola fazında tıklamalar engellenir.
- **Kendi overlay penceremiz yakalamadan hariç tutulur** — yoksa kara delik
  kendi görüntüsünü bükerek sonsuz ayna döngüsü oluşturur.
- Shader `device.makeLibrary(source:)` ile çalışma anında derlenir;
  `.metallib` paketleme derdi yoktur.
- 45. dakikadan önce GPU/yakalama tamamen kapalıdır; molada render 10 fps'e
  düşer.

## Test

```bash
.build/release/KaraDelikOdak --selftest         # durum makinesi birim testleri
.build/release/KaraDelikOdak --fast --autostart # 60× hızlı canlı prova
```
