# Privacy Policy · Gizlilik Politikası · Política de Privacidad

**BlackHolock** · Version 1.0.0 · Last updated: 19 July 2026

[English](#english) · [Türkçe](#türkçe) · [Español](#español)

---

## English

### The short version

BlackHolock has no accounts, no servers, and no analytics. It does not collect,
transmit, or sell any personal data. Everything the app knows about you stays on
your own device.

### What the app stores

One file, on your computer only:

| What | Where |
| --- | --- |
| Your settings (durations, language, effect, toggles) | `settings.json` in the OS application-data folder |

On macOS that is `~/Library/Application Support/BlackHolock/`.
On Windows it is `%APPDATA%\BlackHolock\`.

Nothing else is written. There is no usage history, no session log, no
identifier of any kind, and no crash reporting service.

### What leaves your device

Exactly one thing, and only if you leave **Check for updates** enabled:

- An anonymous HTTPS `GET` request to the public GitHub Releases API to read the
  latest published version number.

That request contains no account, no device identifier, and no information about
you beyond what any web request unavoidably reveals to the receiving server
(your IP address and your user agent, handled by GitHub under
[GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)).
Turning the setting off stops the request entirely, and the app remains fully
functional.

### Screen recording permission

If you enable **Bend the desktop**, the app asks your operating system for
screen-capture permission. This is used only to read your screen's pixels into
graphics memory in order to distort them on screen, in real time, on your own
machine.

Those frames are **never** written to disk, never encoded, never buffered beyond
the single frame being drawn, and never transmitted anywhere. The moment the
effect leaves your screen, the capture stream is stopped and the memory is
released. You can revoke the permission at any time in your operating system's
privacy settings; the app then runs without the distortion.

### Your rights (GDPR / KVKK)

Because BlackHolock processes no personal data and operates no data controller
infrastructure, there is no personal data to access, rectify, port, restrict, or
erase. Under the EU General Data Protection Regulation (GDPR) and the Turkish
Personal Data Protection Law No. 6698 (KVKK), the practical consequences are:

- **No data controller relationship** is created by using the app.
- **No consent** is required, because no processing takes place.
- **Deleting the app**, together with its settings folder shown above, removes
  every trace of it from your device.

If you exercise the update check, GitHub acts as an independent controller for
that request under its own policy, linked above.

### Children

The app collects nothing from anyone, and is therefore equally safe for users of
any age.

### Changes

Material changes to this policy will be published in the repository with a new
version number and date. The version in the release you have installed is the
version that applies to you.

### Contact

Open a public issue at
<https://github.com/GhostFelina/BlackHolePomodoro/issues>.

---

## Türkçe

### Kısa özet

BlackHolock'ta hesap, sunucu ve analiz yoktur. Hiçbir kişisel veriyi toplamaz,
iletmez veya satmaz. Uygulamanın bildiği her şey kendi cihazınızda kalır.

### Uygulamanın sakladığı şeyler

Yalnızca bilgisayarınızda duran tek bir dosya:

| Ne | Nerede |
| --- | --- |
| Ayarlarınız (süreler, dil, efekt, anahtarlar) | İşletim sistemi uygulama verisi klasöründe `settings.json` |

macOS'ta `~/Library/Application Support/BlackHolock/`,
Windows'ta `%APPDATA%\BlackHolock\`.

Bunun dışında hiçbir şey yazılmaz. Kullanım geçmişi, oturum kaydı, herhangi bir
tanımlayıcı ve çökme raporlama servisi yoktur.

### Cihazınızdan çıkan şeyler

Yalnızca tek bir şey, o da **Güncellemeleri denetle** ayarı açıksa:

- En son yayımlanan sürüm numarasını okumak için genel GitHub Releases API'sine
  yapılan anonim bir HTTPS `GET` isteği.

Bu istek hesap, cihaz tanımlayıcısı veya sizinle ilgili herhangi bir bilgi
içermez; herhangi bir web isteğinin karşı sunucuya kaçınılmaz olarak gösterdiği
bilgiler (IP adresiniz ve tarayıcı kimliğiniz) bunun dışındadır ve bunlar
GitHub tarafından kendi gizlilik beyanı kapsamında işlenir. Ayarı kapatmak
isteği tamamen durdurur; uygulama eksiksiz çalışmaya devam eder.

### Ekran kaydı izni

**Masaüstünü bük** seçeneğini açarsanız uygulama işletim sisteminizden ekran
yakalama izni ister. Bu izin yalnızca ekranınızın piksellerini grafik belleğine
okuyup gerçek zamanlı olarak, kendi makinenizde bükmek için kullanılır.

Bu kareler **hiçbir zaman** diske yazılmaz, kodlanmaz, o an çizilen tek kare
dışında tamponlanmaz ve hiçbir yere iletilmez. Efekt ekrandan kalktığı anda
yakalama akışı durdurulur ve bellek serbest bırakılır. İzni istediğiniz zaman
işletim sisteminizin gizlilik ayarlarından geri alabilirsiniz; uygulama o
durumda bükme olmadan çalışır.

### Haklarınız (KVKK / GDPR)

BlackHolock hiçbir kişisel veri işlemediği ve herhangi bir veri sorumlusu
altyapısı çalıştırmadığı için erişilecek, düzeltilecek, taşınacak,
sınırlandırılacak veya silinecek bir kişisel veri bulunmamaktadır. 6698 sayılı
Kişisel Verilerin Korunması Kanunu (KVKK) ve Avrupa Birliği Genel Veri Koruma
Tüzüğü (GDPR) bakımından pratik sonuçlar şunlardır:

- Uygulamanın kullanımı **veri sorumlusu ilişkisi doğurmaz**.
- İşleme gerçekleşmediği için **açık rıza gerekmez**.
- **Uygulamayı ve yukarıda gösterilen ayar klasörünü silmek**, uygulamaya ait
  her izi cihazınızdan kaldırır.

Güncelleme denetimini kullanmanız hâlinde GitHub, o istek bakımından kendi
politikası kapsamında bağımsız veri sorumlusu olarak hareket eder.

### Çocuklar

Uygulama hiç kimseden hiçbir şey toplamaz; bu nedenle her yaştan kullanıcı için
aynı ölçüde güvenlidir.

### Değişiklikler

Bu politikadaki esaslı değişiklikler yeni bir sürüm numarası ve tarihle depoda
yayımlanır. Kurulu olan sürümdeki metin sizin için geçerli olan metindir.

### İletişim

<https://github.com/GhostFelina/BlackHolePomodoro/issues> adresinden herkese açık
bir konu açabilirsiniz.

---

## Español

### Versión corta

BlackHolock no tiene cuentas, ni servidores, ni analítica. No recopila, transmite
ni vende ningún dato personal. Todo lo que la aplicación sabe de ti se queda en
tu propio dispositivo.

### Qué guarda la aplicación

Un único archivo, solo en tu ordenador:

| Qué | Dónde |
| --- | --- |
| Tus ajustes (duraciones, idioma, efecto, interruptores) | `settings.json` en la carpeta de datos de aplicación del sistema |

En macOS es `~/Library/Application Support/BlackHolock/`.
En Windows es `%APPDATA%\BlackHolock\`.

No se escribe nada más. No hay historial de uso, ni registro de sesiones, ni
identificador de ningún tipo, ni servicio de informes de fallos.

### Qué sale de tu dispositivo

Exactamente una cosa, y solo si dejas activada la opción **Buscar
actualizaciones**:

- Una petición HTTPS `GET` anónima a la API pública de Releases de GitHub para
  leer el número de la última versión publicada.

Esa petición no contiene cuenta, ni identificador de dispositivo, ni información
sobre ti más allá de lo que cualquier petición web revela inevitablemente al
servidor receptor (tu dirección IP y tu agente de usuario, tratados por GitHub
bajo su propia declaración de privacidad). Desactivar la opción detiene la
petición por completo y la aplicación sigue siendo plenamente funcional.

### Permiso de grabación de pantalla

Si activas **Curvar el escritorio**, la aplicación solicita al sistema operativo
el permiso de captura de pantalla. Se usa únicamente para leer los píxeles de tu
pantalla en la memoria gráfica y deformarlos en tiempo real, en tu propia
máquina.

Esos fotogramas **nunca** se escriben en disco, nunca se codifican, nunca se
almacenan más allá del fotograma que se está dibujando y nunca se transmiten a
ningún sitio. En cuanto el efecto desaparece de la pantalla, la captura se
detiene y se libera la memoria. Puedes revocar el permiso en cualquier momento
desde los ajustes de privacidad de tu sistema; la aplicación seguirá funcionando
sin la deformación.

### Tus derechos (RGPD)

Dado que BlackHolock no trata datos personales ni opera infraestructura alguna
de responsable del tratamiento, no existen datos personales a los que acceder ni
que rectificar, portar, limitar o suprimir. En términos del Reglamento General de
Protección de Datos (RGPD):

- El uso de la aplicación **no crea una relación de responsable del
  tratamiento**.
- **No se requiere consentimiento**, porque no se produce ningún tratamiento.
- **Desinstalar la aplicación**, junto con la carpeta de ajustes indicada
  arriba, elimina todo rastro de ella en tu dispositivo.

Si utilizas la comprobación de actualizaciones, GitHub actúa como responsable
independiente para esa petición conforme a su propia política.

### Menores

La aplicación no recopila nada de nadie y, por tanto, es igual de segura para
usuarios de cualquier edad.

### Cambios

Los cambios sustanciales en esta política se publicarán en el repositorio con un
número de versión y una fecha nuevos. La versión incluida en la publicación que
tengas instalada es la que se te aplica.

### Contacto

Abre una incidencia pública en
<https://github.com/GhostFelina/BlackHolePomodoro/issues>.
