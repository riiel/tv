package ee.riiel.koduvaade;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Koduvaade: avab tv-riiel.vercel.app otse täisekraanil, ilma brauseri ja aadressiribata.
 * Puldi nooled ja OK jõuavad lehe enda puldijuhtimiseni; tagasi-nupp liigub lehe ajaloos
 * (nt spordilehelt koduvaatesse) ja koduvaates paneb rakenduse kinni.
 */
public class MainActivity extends Activity {
    private static final String HOME_URL = "https://tv-riiel.vercel.app/";
    private static final String HOST = "tv-riiel.vercel.app";

    private static final int REQ_LOCATION = 1;

    private WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;
    /** Kas lehe raadio mängib (leht teatab ise KoduvaadeApp.radio kaudu). */
    private volatile boolean radioPlaying;
    private boolean inBackground;

    /** Leht annab teada raadio olekust; teenus hoiab raadio taustal korralikult käimas. */
    private class AppBridge {
        @JavascriptInterface
        public void radio(boolean playing, String station, String title) {
            handler.post(() -> {
                boolean was = radioPlaying;
                radioPlaying = playing;
                // Android 13+: küsi korra luba teatisele (sealt saab raadio peatada ja näeb lugu)
                if (playing && !was && android.os.Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED
                        && !getPreferences(MODE_PRIVATE).getBoolean("notifAsked", false)) {
                    getPreferences(MODE_PRIVATE).edit().putBoolean("notifAsked", true).apply();
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2);
                }
                RadioService.update(MainActivity.this, playing, station, title);
                // Raadio peatati taustal (nt teatisest): nüüd võib lehe magama panna
                if (was && !playing && inBackground) sleepPage();
            });
        }
    }

    private boolean hasLocationPermission() {
        if (android.os.Build.VERSION.SDK_INT < 23) return true;
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0d1117"));
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        hideSystemUi();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);              // teema, asukoht jm jäävad meelde
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setGeolocationEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " KoduvaadeTV/1.0");

        web.addJavascriptInterface(new AppBridge(), "KoduvaadeApp");
        RadioService.onToggle = () -> handler.post(() ->
                web.evaluateJavascript("window.koduRadio && koduRadio.state().playing && koduRadio.toggle()", null));

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                // Telefonis küsi Androidilt asukohaluba; Shieldil pole GPS-i ja leht kasutab siis IP-d
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                } else if (android.os.Build.VERSION.SDK_INT >= 23) {
                    pendingGeoOrigin = origin;
                    pendingGeoCallback = callback;
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                } else {
                    callback.invoke(origin, false, false);
                }
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                return u != null && !HOST.equalsIgnoreCase(u.getHost());   // võõrad lingid ei ava midagi
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Kui internet on maas (nt pärast teleri käivitumist), proovi 10 s pärast uuesti
                if (request.isForMainFrame()) {
                    handler.removeCallbacksAndMessages(null);
                    handler.postDelayed(() -> web.loadUrl(HOME_URL), 10000);
                }
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(HOME_URL);
        web.requestFocus();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_LOCATION || pendingGeoCallback == null) return;
        boolean granted = false;
        for (int r : grantResults) if (r == PackageManager.PERMISSION_GRANTED) granted = true;
        pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
        pendingGeoCallback = null;
        pendingGeoOrigin = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        inBackground = false;
        web.onResume();
        web.resumeTimers();
    }

    @Override
    protected void onPause() {
        inBackground = true;
        // Kui raadio mängib, jääb leht ärkvel ja raadio mängib avaekraanil edasi (teenus hoiab seda).
        // Muidu pannakse leht magama, et taustal midagi ei jookseks.
        if (!radioPlaying) sleepPage();
        super.onPause();
    }

    private void sleepPage() {
        web.onPause();
        web.pauseTimers();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        RadioService.onToggle = null;
        stopService(new android.content.Intent(this, RadioService.class));
        web.destroy();
        super.onDestroy();
    }
}
