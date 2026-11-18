package ee.riiel.koduvaade;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Hoiab raadio taustal korralikult käimas, kui Shieldil/telefonis rakendusest välja minnakse:
 * esiplaaniteenus (Android ei uinuta ega sulge rakendust), WiFi- ja protsessorilukk (striim ei katke)
 * ning meediaseanss, mille kaudu puldi Play/Paus ja Shieldi "Praegu mängib" paneel raadiot juhivad.
 * Raadio ise mängib edasi veebilehel (WebView), teenus ainult hoiab seda ärkvel.
 */
public class RadioService extends Service {
    static final String ACTION_UPDATE = "ee.riiel.koduvaade.UPDATE";
    static final String ACTION_TOGGLE = "ee.riiel.koduvaade.TOGGLE";
    static final String ACTION_STOP = "ee.riiel.koduvaade.STOP";
    private static final String CHANNEL = "raadio";
    private static final int NOTIF_ID = 8;

    /** Kutsutakse, kui teatisest või puldist raadio peatatakse (MainActivity paneb selle paika). */
    static Runnable onToggle;

    private MediaSession session;
    private PowerManager.WakeLock cpuLock;
    private WifiManager.WifiLock wifiLock;
    private String station = "", title = "";

    static void update(Context c, boolean playing, String station, String title) {
        Intent i = new Intent(c, RadioService.class)
                .setAction(playing ? ACTION_UPDATE : ACTION_STOP)
                .putExtra("station", station).putExtra("title", title);
        try {
            if (playing && Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else if (playing) c.startService(i);
            else c.stopService(new Intent(c, RadioService.class));
        } catch (Exception ignored) { }   // nt taustalt käivitamine keelatud: raadio mängib siis ikka, lihtsalt ilma teenuseta
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Raadio", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "koduvaade:raadio");
        cpuLock.acquire();
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wm != null) {
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "koduvaade:raadio");
            wifiLock.acquire();
        }

        session = new MediaSession(this, "Koduvaade");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPause() { toggle(); }
            @Override public void onStop() { toggle(); }
            @Override public void onPlay() { openApp(); }
        });
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP | PlaybackState.ACTION_PLAY_PAUSE)
                .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build());
        session.setActive(true);
    }

    private void toggle() {
        Runnable r = onToggle;
        if (r != null) r.run();
        stopSelf();
    }

    private void openApp() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_TOGGLE.equals(intent.getAction())) { toggle(); return START_NOT_STICKY; }
        if (intent != null) {
            station = String.valueOf(intent.getStringExtra("station"));
            title = String.valueOf(intent.getStringExtra("title"));
        }
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? station : title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, station)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, title.isEmpty() ? station : title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, station)
                .build());
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIF_ID, n);
        return START_NOT_STICKY;
    }

    private Notification buildNotification() {
        int piFlags = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), piFlags);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, RadioService.class).setAction(ACTION_TOGGLE), piFlags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(station.isEmpty() ? "Raadio" : station)
                .setContentText(title)
                .setContentIntent(open)
                .setOngoing(true)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Peata", stop).build())
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0));
        return b.build();
    }

    @Override
    public void onDestroy() {
        if (session != null) { session.setActive(false); session.release(); }
        if (cpuLock != null && cpuLock.isHeld()) cpuLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
