package com.skizgairos.game;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

/**
 * Edge-to-edge game activity.
 *
 * The WebView draws behind the status bar, navigation bar and display
 * cutout. The real WindowInsets (system bars + cutout) are reported to the
 * game in CSS pixels, so the SKIZGAIROS artwork is laid out inside the safe
 * area while the soft extension of the art fills the areas behind the bars.
 */
public class MainActivity extends BridgeActivity {

    private volatile String insetsJson = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        // Light status/navigation icons over the bright sky artwork.
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);

        final WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(Color.rgb(0x6f, 0xb3, 0xff));
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        webView.addJavascriptInterface(new InsetsBridge(), "SkzNative");

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets i = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float d = getResources().getDisplayMetrics().density;
            insetsJson = String.format(Locale.US, "{\"top\":%.1f,\"right\":%.1f,\"bottom\":%.1f,\"left\":%.1f}",
                i.top / d, i.right / d, i.bottom / d, i.left / d);
            v.post(() -> webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('skz-insets',{detail:" + insetsJson + "}));", null));
            // Keep the WebView full-screen: no padding is applied for the bars.
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);
    }

    /** Lets the game read the current insets at start-up. */
    private class InsetsBridge {
        @JavascriptInterface
        public String getInsets() {
            return insetsJson;
        }
    }
}
