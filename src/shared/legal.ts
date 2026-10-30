import type { Locale } from './types'

/**
 * Privacy Policy and Terms of Use shown in the app. Changing either document requires a new
 * LEGAL_VERSION, which asks every user to accept the new text once.
 */
export const LEGAL_VERSION = '2026-10-31'

export const REPO_URL = 'https://github.com/demirgitbuh/SonoraSoundRecorder'
export const ISSUES_URL = `${REPO_URL}/issues`

export type LegalDocId = 'terms' | 'privacy'

export interface LegalSection {
  title: string
  body: string[]
}

export interface LegalDoc {
  title: string
  sections: LegalSection[]
}

type LegalSet = Record<LegalDocId, LegalDoc>

const en: LegalSet = {
  terms: {
    title: 'Terms of Use',
    sections: [
      {
        title: 'Licence',
        body: [
          'Sonora Sound Recorder is free software, licensed under the GNU General Public License version 3 (GPL-3.0). You may use it for any purpose, study and change the source code, and share copies or modified versions under the same licence.',
          'These terms summarise how the app is provided. If they ever differ from the GPL-3.0, the GPL-3.0 applies.'
        ]
      },
      {
        title: 'No warranty',
        body: [
          'The app is provided “as is”, without warranty of any kind, express or implied, including fitness for a particular purpose. To the extent permitted by law, the authors are not liable for any damage, data loss or missed recordings arising from its use.',
          'Keep copies of recordings that matter to you.'
        ]
      },
      {
        title: 'Your responsibility when recording',
        body: [
          'Many countries require the consent of everyone involved before a conversation, call or meeting is recorded. You are responsible for obtaining the consent your local law requires.',
          'Audio played by other apps and websites may be protected by copyright. Record and use it only where you are allowed to.'
        ]
      },
      {
        title: 'Included components',
        body: [
          'Sonora includes third-party software such as FFmpeg, whisper.cpp, Electron and the Inter and Instrument Serif typefaces. Each is used under its own licence, listed in THIRD_PARTY_NOTICES.md and the licences folder of the installation.',
          'Speech recognition models are not included. A model you choose remains under its own licence.'
        ]
      },
      {
        title: 'Updates',
        body: [
          'Sonora can look for new versions on GitHub Releases. Nothing is downloaded or installed until you confirm it.'
        ]
      },
      {
        title: 'Changes and contact',
        body: [
          'If these terms change, Sonora shows the new version and asks you to accept it before you continue.',
          'Questions and reports: github.com/demirgitbuh/SonoraSoundRecorder/issues.'
        ]
      }
    ]
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      {
        title: 'In short',
        body: [
          'Sonora works on your computer. There is no account, no analytics, no telemetry and no advertising. Your recordings and transcripts never leave your device unless you share them yourself.'
        ]
      },
      {
        title: 'Recordings and transcripts',
        body: [
          'Recordings are saved as ordinary audio files in the folder you choose. Transcription runs on your computer with whisper.cpp and the model file you select; audio is never sent to a server.'
        ]
      },
      {
        title: 'Data stored on your computer',
        body: [
          'In its data folder, Sonora keeps your settings, the archive index (names, notes, tags, markers), transcripts, waveform previews, recordings that were not saved yet, and technical logs. Logs contain technical events only, never audio or transcript text.',
          'You can export the logs or open their folder in Settings. Uninstalling the app keeps this folder so an update never loses your data; delete it yourself to remove everything.'
        ]
      },
      {
        title: 'Network connections',
        body: [
          'Sonora connects to the internet only to check GitHub Releases for a newer version (if update checks are on) and to download an update you confirm. GitHub receives the usual request data, such as your IP address and the app version; GitHub’s privacy statement applies to it.',
          'Links you open from Sonora open in your web browser.'
        ]
      },
      {
        title: 'Microphone and screen access',
        body: [
          'Microphone access is used only while you record or check an input. On macOS, the Screen Recording permission is needed to capture system audio; no picture of your screen is stored.'
        ]
      },
      {
        title: 'Changes and contact',
        body: [
          'If this policy changes, Sonora shows the new version before you continue.',
          'Questions: github.com/demirgitbuh/SonoraSoundRecorder/issues.'
        ]
      }
    ]
  }
}

const tr: LegalSet = {
  terms: {
    title: 'Kullanım Koşulları',
    sections: [
      {
        title: 'Lisans',
        body: [
          'Sonora Sound Recorder, GNU Genel Kamu Lisansı sürüm 3 (GPL-3.0) ile lisanslanmış özgür bir yazılımdır. Her amaçla kullanabilir, kaynak kodunu inceleyip değiştirebilir, kopyalarını veya değiştirilmiş sürümlerini aynı lisansla paylaşabilirsiniz.',
          'Bu koşullar uygulamanın nasıl sunulduğunu özetler. GPL-3.0 ile çeliştiği bir durumda GPL-3.0 geçerlidir.'
        ]
      },
      {
        title: 'Garanti yoktur',
        body: [
          'Uygulama, belirli bir amaca uygunluk dahil, açık ya da örtük hiçbir garanti olmaksızın “olduğu gibi” sunulur. Yasaların izin verdiği ölçüde yazarlar; kullanımdan doğan hasar, veri kaybı veya kaçırılan kayıtlardan sorumlu tutulamaz.',
          'Sizin için önemli kayıtların kopyasını saklayın.'
        ]
      },
      {
        title: 'Kayıt yaparken sorumluluğunuz',
        body: [
          'Birçok ülkede bir konuşma, arama veya toplantı kaydedilmeden önce tüm katılımcıların onayı gerekir. Bulunduğunuz yerin yasalarının istediği onayı almak sizin sorumluluğunuzdadır.',
          'Başka uygulamaların ve sitelerin çaldığı sesler telif hakkıyla korunuyor olabilir. Bunları yalnızca izin verilen durumlarda kaydedin ve kullanın.'
        ]
      },
      {
        title: 'Dahil edilen bileşenler',
        body: [
          'Sonora; FFmpeg, whisper.cpp, Electron ile Inter ve Instrument Serif yazı tipleri gibi üçüncü taraf yazılımlar içerir. Her biri kendi lisansıyla kullanılır; lisanslar THIRD_PARTY_NOTICES.md dosyasında ve kurulumdaki licenses klasöründe yer alır.',
          'Konuşma tanıma modelleri dahil değildir. Seçtiğiniz model kendi lisansına tabidir.'
        ]
      },
      {
        title: 'Güncellemeler',
        body: ['Sonora yeni sürümleri GitHub Releases üzerinde arayabilir. Siz onaylamadan hiçbir şey indirilmez veya kurulmaz.']
      },
      {
        title: 'Değişiklikler ve iletişim',
        body: [
          'Bu koşullar değişirse Sonora yeni sürümü gösterir ve devam etmeden önce onayınızı ister.',
          'Sorular ve bildirimler: github.com/demirgitbuh/SonoraSoundRecorder/issues.'
        ]
      }
    ]
  },
  privacy: {
    title: 'Gizlilik Politikası',
    sections: [
      {
        title: 'Kısaca',
        body: [
          'Sonora bilgisayarınızda çalışır. Hesap, analiz, telemetri veya reklam yoktur. Kayıtlarınız ve yazıya çevrilmiş metinleriniz, siz paylaşmadıkça cihazınızdan çıkmaz.'
        ]
      },
      {
        title: 'Kayıtlar ve metinler',
        body: [
          'Kayıtlar, seçtiğiniz klasörde sıradan ses dosyaları olarak saklanır. Yazıya çevirme, seçtiğiniz model dosyasıyla whisper.cpp kullanılarak bilgisayarınızda yapılır; ses hiçbir sunucuya gönderilmez.'
        ]
      },
      {
        title: 'Bilgisayarınızda saklanan veriler',
        body: [
          'Sonora veri klasöründe ayarlarınızı, arşiv dizinini (adlar, notlar, etiketler, işaretler), metinleri, dalga formu önizlemelerini, henüz kaydedilmemiş kayıtları ve teknik günlükleri tutar. Günlükler yalnızca teknik olayları içerir; asla ses veya metin içermez.',
          'Günlükleri Ayarlar’dan dışa aktarabilir veya klasörlerini açabilirsiniz. Uygulamayı kaldırmak bu klasörü silmez, böylece bir güncelleme verilerinizi kaybetmez; her şeyi kaldırmak için klasörü kendiniz silin.'
        ]
      },
      {
        title: 'Ağ bağlantıları',
        body: [
          'Sonora internete yalnızca, güncelleme denetimi açıksa GitHub Releases’ta yeni sürüm aramak ve onayladığınız bir güncellemeyi indirmek için bağlanır. GitHub, IP adresiniz ve uygulama sürümü gibi olağan istek bilgilerini alır; bunlara GitHub’ın gizlilik bildirimi uygulanır.',
          'Sonora’dan açtığınız bağlantılar web tarayıcınızda açılır.'
        ]
      },
      {
        title: 'Mikrofon ve ekran erişimi',
        body: [
          'Mikrofon erişimi yalnızca kayıt yaparken veya bir girişi denetlerken kullanılır. macOS’ta sistem sesini almak için Ekran Kaydı izni gerekir; ekranınızın görüntüsü saklanmaz.'
        ]
      },
      {
        title: 'Değişiklikler ve iletişim',
        body: [
          'Bu politika değişirse Sonora devam etmeden önce yeni sürümü gösterir.',
          'Sorular: github.com/demirgitbuh/SonoraSoundRecorder/issues.'
        ]
      }
    ]
  }
}

const de: LegalSet = {
  terms: {
    title: 'Nutzungsbedingungen',
    sections: [
      {
        title: 'Lizenz',
        body: [
          'Sonora Sound Recorder ist freie Software unter der GNU General Public License Version 3 (GPL-3.0). Sie dürfen das Programm für jeden Zweck nutzen, den Quellcode untersuchen und ändern sowie Kopien oder geänderte Versionen unter derselben Lizenz weitergeben.',
          'Diese Bedingungen fassen zusammen, wie die App bereitgestellt wird. Bei Abweichungen gilt die GPL-3.0.'
        ]
      },
      {
        title: 'Keine Gewährleistung',
        body: [
          'Die App wird „wie besehen“ bereitgestellt, ohne ausdrückliche oder stillschweigende Gewährleistung, auch nicht für die Eignung für einen bestimmten Zweck. Soweit gesetzlich zulässig, haften die Autoren nicht für Schäden, Datenverluste oder verpasste Aufnahmen durch die Nutzung.',
          'Bewahren Sie Kopien wichtiger Aufnahmen auf.'
        ]
      },
      {
        title: 'Ihre Verantwortung beim Aufnehmen',
        body: [
          'In vielen Ländern müssen alle Beteiligten zustimmen, bevor ein Gespräch, Anruf oder Meeting aufgezeichnet wird. Sie sind dafür verantwortlich, die nach Ihrem Recht erforderliche Zustimmung einzuholen.',
          'Audio, das andere Apps und Websites abspielen, kann urheberrechtlich geschützt sein. Nehmen Sie es nur auf und nutzen Sie es nur, wo es erlaubt ist.'
        ]
      },
      {
        title: 'Enthaltene Komponenten',
        body: [
          'Sonora enthält Software von Drittanbietern wie FFmpeg, whisper.cpp, Electron sowie die Schriften Inter und Instrument Serif. Jede wird unter ihrer eigenen Lizenz verwendet; die Lizenzen stehen in THIRD_PARTY_NOTICES.md und im Ordner „licenses“ der Installation.',
          'Spracherkennungsmodelle sind nicht enthalten. Ein von Ihnen gewähltes Modell unterliegt seiner eigenen Lizenz.'
        ]
      },
      {
        title: 'Updates',
        body: ['Sonora kann auf GitHub Releases nach neuen Versionen suchen. Nichts wird heruntergeladen oder installiert, bevor Sie es bestätigen.']
      },
      {
        title: 'Änderungen und Kontakt',
        body: [
          'Ändern sich diese Bedingungen, zeigt Sonora die neue Fassung und bittet vor dem Fortfahren um Ihre Zustimmung.',
          'Fragen und Meldungen: github.com/demirgitbuh/SonoraSoundRecorder/issues.'
        ]
      }
    ]
  },
  privacy: {
    title: 'Datenschutzerklärung',
    sections: [
      {
        title: 'Kurz gesagt',
        body: [
          'Sonora arbeitet auf Ihrem Computer. Es gibt kein Konto, keine Analyse, keine Telemetrie und keine Werbung. Ihre Aufnahmen und Transkripte verlassen Ihr Gerät nur, wenn Sie sie selbst teilen.'
        ]
      },
      {
        title: 'Aufnahmen und Transkripte',
        body: [
          'Aufnahmen werden als gewöhnliche Audiodateien in dem von Ihnen gewählten Ordner gespeichert. Die Transkription läuft mit whisper.cpp und der von Ihnen gewählten Modelldatei auf Ihrem Computer; Audio wird nie an einen Server gesendet.'
        ]
      },
      {
        title: 'Auf Ihrem Computer gespeicherte Daten',
        body: [
          'Im Datenordner speichert Sonora Ihre Einstellungen, den Archivindex (Namen, Notizen, Tags, Marker), Transkripte, Wellenform-Vorschauen, noch nicht gespeicherte Aufnahmen und technische Protokolle. Protokolle enthalten nur technische Ereignisse, niemals Audio oder Transkripttext.',
          'Protokolle können Sie in den Einstellungen exportieren oder ihren Ordner öffnen. Beim Deinstallieren bleibt dieser Ordner erhalten, damit ein Update keine Daten verliert; löschen Sie ihn selbst, um alles zu entfernen.'
        ]
      },
      {
        title: 'Netzwerkverbindungen',
        body: [
          'Sonora verbindet sich nur mit dem Internet, um auf GitHub Releases nach einer neueren Version zu suchen (wenn die Updateprüfung aktiv ist) und um ein von Ihnen bestätigtes Update herunterzuladen. GitHub erhält dabei die üblichen Anfragedaten wie Ihre IP-Adresse und die App-Version; dafür gilt die Datenschutzerklärung von GitHub.',
          'Links, die Sie in Sonora öffnen, werden in Ihrem Webbrowser geöffnet.'
        ]
      },
      {
        title: 'Mikrofon- und Bildschirmzugriff',
        body: [
          'Der Mikrofonzugriff wird nur während einer Aufnahme oder Eingangsprüfung genutzt. Unter macOS ist für Systemaudio die Berechtigung „Bildschirmaufnahme“ nötig; es wird kein Bild Ihres Bildschirms gespeichert.'
        ]
      },
      {
        title: 'Änderungen und Kontakt',
        body: [
          'Ändert sich diese Erklärung, zeigt Sonora die neue Fassung, bevor Sie fortfahren.',
          'Fragen: github.com/demirgitbuh/SonoraSoundRecorder/issues.'
        ]
      }
    ]
  }
}

const fr: LegalSet = {
  terms: {
    title: 'Conditions d’utilisation',
    sections: [
      {
        title: 'Licence',
        body: [
          'Sonora Sound Recorder est un logiciel libre distribué sous la licence publique générale GNU version 3 (GPL-3.0). Vous pouvez l’utiliser pour tout usage, étudier et modifier son code source, et partager des copies ou des versions modifiées sous la même licence.',
          'Ces conditions résument la manière dont l’application est fournie. En cas de divergence, la GPL-3.0 prévaut.'
        ]
      },
      {
        title: 'Absence de garantie',
        body: [
          'L’application est fournie « telle quelle », sans garantie d’aucune sorte, expresse ou implicite, y compris d’adéquation à un usage particulier. Dans les limites permises par la loi, les auteurs ne sont pas responsables des dommages, pertes de données ou enregistrements manqués liés à son utilisation.',
          'Conservez des copies des enregistrements importants.'
        ]
      },
      {
        title: 'Votre responsabilité lors de l’enregistrement',
        body: [
          'Dans de nombreux pays, toutes les personnes concernées doivent donner leur accord avant l’enregistrement d’une conversation, d’un appel ou d’une réunion. Il vous appartient d’obtenir le consentement exigé par la loi applicable.',
          'Le son diffusé par d’autres applications et sites peut être protégé par le droit d’auteur. Enregistrez-le et utilisez-le uniquement lorsque cela vous est permis.'
        ]
      },
      {
        title: 'Composants inclus',
        body: [
          'Sonora inclut des logiciels tiers tels que FFmpeg, whisper.cpp, Electron ainsi que les polices Inter et Instrument Serif. Chacun est utilisé selon sa propre licence, indiquée dans THIRD_PARTY_NOTICES.md et dans le dossier « licenses » de l’installation.',
          'Les modèles de reconnaissance vocale ne sont pas inclus. Le modèle que vous choisissez reste soumis à sa propre licence.'
        ]
      },
      {
        title: 'Mises à jour',
        body: ['Sonora peut rechercher de nouvelles versions sur GitHub Releases. Rien n’est téléchargé ni installé sans votre confirmation.']
      },
      {
        title: 'Modifications et contact',
        body: [
          'Si ces conditions changent, Sonora affiche la nouvelle version et vous demande de l’accepter avant de continuer.',
          'Questions et signalements : github.com/demirgitbuh/SonoraSoundRecorder/issues.'
        ]
      }
    ]
  },
  privacy: {
    title: 'Politique de confidentialité',
    sections: [
      {
        title: 'En bref',
        body: [
          'Sonora fonctionne sur votre ordinateur. Il n’y a ni compte, ni statistiques, ni télémétrie, ni publicité. Vos enregistrements et transcriptions ne quittent votre appareil que si vous les partagez vous-même.'
        ]
      },
      {
        title: 'Enregistrements et transcriptions',
        body: [
          'Les enregistrements sont sauvegardés sous forme de fichiers audio ordinaires dans le dossier de votre choix. La transcription s’exécute sur votre ordinateur avec whisper.cpp et le modèle que vous choisissez ; l’audio n’est jamais envoyé à un serveur.'
        ]
      },
      {
        title: 'Données stockées sur votre ordinateur',
        body: [
          'Dans son dossier de données, Sonora conserve vos réglages, l’index de l’archive (noms, notes, étiquettes, repères), les transcriptions, les aperçus de forme d’onde, les enregistrements pas encore sauvegardés et des journaux techniques. Les journaux ne contiennent que des événements techniques, jamais d’audio ni de texte transcrit.',
          'Vous pouvez exporter les journaux ou ouvrir leur dossier dans les Réglages. La désinstallation conserve ce dossier afin qu’une mise à jour ne perde aucune donnée ; supprimez-le vous-même pour tout effacer.'
        ]
      },
      {
        title: 'Connexions réseau',
        body: [
          'Sonora se connecte à Internet uniquement pour rechercher une nouvelle version sur GitHub Releases (si la vérification est activée) et pour télécharger une mise à jour que vous confirmez. GitHub reçoit les données habituelles d’une requête, comme votre adresse IP et la version de l’application ; la déclaration de confidentialité de GitHub s’y applique.',
          'Les liens ouverts depuis Sonora s’ouvrent dans votre navigateur.'
        ]
      },
      {
        title: 'Accès au micro et à l’écran',
        body: [
          'L’accès au micro n’est utilisé que pendant un enregistrement ou un test d’entrée. Sous macOS, l’autorisation « Enregistrement de l’écran » est nécessaire pour capter le son du système ; aucune image de votre écran n’est conservée.'
        ]
      },
      {
        title: 'Modifications et contact',
        body: [
          'Si cette politique change, Sonora affiche la nouvelle version avant que vous ne continuiez.',
          'Questions : github.com/demirgitbuh/SonoraSoundRecorder/issues.'
        ]
      }
    ]
  }
}

const zh: LegalSet = {
  terms: {
    title: '使用条款',
    sections: [
      {
        title: '许可',
        body: [
          'Sonora Sound Recorder 是基于 GNU 通用公共许可证第 3 版（GPL-3.0）发布的自由软件。你可以出于任何目的使用它，研究和修改源代码，并以相同许可分享副本或修改版本。',
          '本条款概述应用的提供方式。如与 GPL-3.0 不一致，以 GPL-3.0 为准。'
        ]
      },
      {
        title: '不提供担保',
        body: [
          '本应用按“现状”提供，不附带任何明示或默示的担保，包括对特定用途适用性的担保。在法律允许的范围内，作者不对因使用本应用造成的任何损害、数据丢失或遗漏的录音承担责任。',
          '请为重要的录音保留副本。'
        ]
      },
      {
        title: '录音时你的责任',
        body: [
          '许多国家要求在录制对话、通话或会议之前征得所有参与者的同意。你有责任按照当地法律取得所需的同意。',
          '其他应用和网站播放的音频可能受版权保护。请仅在允许的情况下录制和使用。'
        ]
      },
      {
        title: '包含的组件',
        body: [
          'Sonora 包含 FFmpeg、whisper.cpp、Electron 以及 Inter 和 Instrument Serif 字体等第三方软件。它们各自依照自己的许可使用，许可列于 THIRD_PARTY_NOTICES.md 和安装目录的 licenses 文件夹中。',
          '不包含语音识别模型。你选择的模型仍受其自身许可约束。'
        ]
      },
      {
        title: '更新',
        body: ['Sonora 可以在 GitHub Releases 上查找新版本。未经你的确认，不会下载或安装任何内容。']
      },
      {
        title: '变更与联系',
        body: ['如果本条款发生变化，Sonora 会显示新版本，并在你继续之前请你接受。', '问题与反馈：github.com/demirgitbuh/SonoraSoundRecorder/issues。']
      }
    ]
  },
  privacy: {
    title: '隐私政策',
    sections: [
      {
        title: '简而言之',
        body: ['Sonora 在你的电脑上运行。没有账户、没有统计分析、没有遥测，也没有广告。除非你自己分享，你的录音和转写文本不会离开你的设备。']
      },
      {
        title: '录音与转写',
        body: ['录音以普通音频文件的形式保存在你选择的文件夹中。转写使用 whisper.cpp 和你选择的模型文件在本机完成，音频绝不会发送到服务器。']
      },
      {
        title: '保存在你电脑上的数据',
        body: [
          'Sonora 在其数据文件夹中保存你的设置、存档索引（名称、备注、标签、标记）、转写文本、波形预览、尚未保存的录音以及技术日志。日志只包含技术事件，绝不包含音频或转写文本。',
          '你可以在设置中导出日志或打开日志文件夹。卸载应用会保留该文件夹，以免更新导致数据丢失；如需全部删除，请自行删除该文件夹。'
        ]
      },
      {
        title: '网络连接',
        body: [
          'Sonora 仅在以下情况下联网：在开启更新检查时到 GitHub Releases 查找新版本，以及下载你确认的更新。GitHub 会收到常规的请求信息，例如你的 IP 地址和应用版本，并适用 GitHub 的隐私声明。',
          '你在 Sonora 中打开的链接会在网页浏览器中打开。'
        ]
      },
      {
        title: '麦克风与屏幕访问',
        body: ['仅在录音或检查输入时使用麦克风。在 macOS 上，录制系统声音需要“屏幕录制”权限；不会保存任何屏幕画面。']
      },
      {
        title: '变更与联系',
        body: ['如果本政策发生变化，Sonora 会在你继续之前显示新版本。', '问题：github.com/demirgitbuh/SonoraSoundRecorder/issues。']
      }
    ]
  }
}

const ru: LegalSet = {
  terms: {
    title: 'Условия использования',
    sections: [
      {
        title: 'Лицензия',
        body: [
          'Sonora Sound Recorder — свободная программа, распространяемая по лицензии GNU General Public License версии 3 (GPL-3.0). Вы можете использовать её для любых целей, изучать и изменять исходный код, а также распространять копии или изменённые версии на тех же условиях.',
          'Эти условия кратко описывают, как предоставляется приложение. При расхождении применяется GPL-3.0.'
        ]
      },
      {
        title: 'Отсутствие гарантий',
        body: [
          'Приложение предоставляется «как есть», без каких-либо явных или подразумеваемых гарантий, в том числе пригодности для определённой цели. В пределах, допустимых законом, авторы не несут ответственности за ущерб, потерю данных или пропущенные записи, связанные с его использованием.',
          'Храните копии важных записей.'
        ]
      },
      {
        title: 'Ваша ответственность при записи',
        body: [
          'Во многих странах для записи разговора, звонка или встречи требуется согласие всех участников. Вы отвечаете за получение согласия, которого требует местный закон.',
          'Звук, воспроизводимый другими приложениями и сайтами, может быть защищён авторским правом. Записывайте и используйте его только там, где это разрешено.'
        ]
      },
      {
        title: 'Включённые компоненты',
        body: [
          'Sonora содержит стороннее ПО, например FFmpeg, whisper.cpp, Electron, а также шрифты Inter и Instrument Serif. Каждый компонент используется по собственной лицензии; лицензии перечислены в THIRD_PARTY_NOTICES.md и в папке licenses установленного приложения.',
          'Модели распознавания речи не входят в состав. Выбранная вами модель распространяется по собственной лицензии.'
        ]
      },
      {
        title: 'Обновления',
        body: ['Sonora может искать новые версии в GitHub Releases. Ничего не скачивается и не устанавливается без вашего подтверждения.']
      },
      {
        title: 'Изменения и связь',
        body: [
          'Если условия изменятся, Sonora покажет новую редакцию и попросит принять её, прежде чем продолжить.',
          'Вопросы и сообщения: github.com/demirgitbuh/SonoraSoundRecorder/issues.'
        ]
      }
    ]
  },
  privacy: {
    title: 'Политика конфиденциальности',
    sections: [
      {
        title: 'Коротко',
        body: [
          'Sonora работает на вашем компьютере. Нет учётной записи, аналитики, телеметрии и рекламы. Ваши записи и расшифровки не покидают устройство, если вы сами ими не поделитесь.'
        ]
      },
      {
        title: 'Записи и расшифровки',
        body: [
          'Записи сохраняются как обычные аудиофайлы в выбранной вами папке. Расшифровка выполняется на вашем компьютере с помощью whisper.cpp и выбранного вами файла модели; звук никогда не отправляется на сервер.'
        ]
      },
      {
        title: 'Данные на вашем компьютере',
        body: [
          'В папке данных Sonora хранит ваши настройки, индекс архива (названия, заметки, теги, метки), расшифровки, превью волновых форм, ещё не сохранённые записи и технические журналы. Журналы содержат только технические события и никогда — звук или текст расшифровок.',
          'Журналы можно экспортировать или открыть их папку в настройках. При удалении приложения эта папка сохраняется, чтобы обновление не привело к потере данных; чтобы удалить всё, удалите её вручную.'
        ]
      },
      {
        title: 'Сетевые подключения',
        body: [
          'Sonora подключается к интернету только для поиска новой версии в GitHub Releases (если проверка обновлений включена) и для загрузки подтверждённого вами обновления. GitHub получает обычные данные запроса, например ваш IP-адрес и версию приложения; к ним применяется заявление GitHub о конфиденциальности.',
          'Ссылки, открытые из Sonora, открываются в вашем браузере.'
        ]
      },
      {
        title: 'Доступ к микрофону и экрану',
        body: [
          'Микрофон используется только во время записи или проверки входа. В macOS для записи системного звука нужно разрешение «Запись экрана»; изображение экрана не сохраняется.'
        ]
      },
      {
        title: 'Изменения и связь',
        body: ['Если политика изменится, Sonora покажет новую редакцию, прежде чем вы продолжите.', 'Вопросы: github.com/demirgitbuh/SonoraSoundRecorder/issues.']
      }
    ]
  }
}

export const LEGAL_DOCS: Record<Locale, LegalSet> = { en, tr, de, fr, zh, ru }

export function legalDoc(locale: Locale, id: LegalDocId): LegalDoc {
  return (LEGAL_DOCS[locale] ?? en)[id]
}

export function legalAccepted(legal: { acceptedVersion: string | null }): boolean {
  return legal.acceptedVersion === LEGAL_VERSION
}
