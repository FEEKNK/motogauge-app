package com.motogauge.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;

public class NativeOBDBridge {
    private static final String TAG = "NativeOBDBridge";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private final Activity activity;
    private final WebView webView;
    private final Handler mainHandler;

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothSocket socket;
    private InputStream inputStream;
    private OutputStream outputStream;
    private Thread readThread;
    private volatile boolean isConnected = false;

    public NativeOBDBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.mainHandler = new Handler(Looper.getMainLooper());
        try {
            this.bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
        } catch (Exception e) {
            Log.e(TAG, "BluetoothAdapter error", e);
        }
    }

    @JavascriptInterface
    public boolean isNativeAvailable() {
        return true;
    }

    @JavascriptInterface
    public boolean isBluetoothEnabled() {
        return bluetoothAdapter != null && bluetoothAdapter.isEnabled();
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    public String getBondedDevices() {
        JSONArray arr = new JSONArray();
        if (bluetoothAdapter == null) return arr.toString();

        try {
            Set<BluetoothDevice> paired = bluetoothAdapter.getBondedDevices();
            if (paired != null) {
                for (BluetoothDevice d : paired) {
                    JSONObject obj = new JSONObject();
                    obj.put("name", d.getName() != null ? d.getName() : "Unknown");
                    obj.put("address", d.getAddress());
                    arr.put(obj);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error listing bonded devices", e);
        }
        return arr.toString();
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    public boolean connect(String address) {
        disconnect();

        if (bluetoothAdapter == null || address == null || address.isEmpty()) {
            notifyError("Bluetooth adapter not available or invalid address");
            return false;
        }

        try {
            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
            if (device == null) {
                notifyError("Device not found: " + address);
                return false;
            }

            // Attempt standard SPP RFCOMM socket
            BluetoothSocket tmpSocket = null;
            try {
                tmpSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                tmpSocket.connect();
            } catch (IOException e) {
                Log.w(TAG, "Standard SPP failed, trying reflection fallback", e);
                try {
                    Method m = device.getClass().getMethod("createRfcommSocket", new Class[]{int.class});
                    tmpSocket = (BluetoothSocket) m.invoke(device, 1);
                    if (tmpSocket != null) {
                        tmpSocket.connect();
                    }
                } catch (Exception ex) {
                    Log.e(TAG, "Fallback RFCOMM connection failed", ex);
                    notifyError("Cannot connect to " + address + ": " + ex.getMessage());
                    return false;
                }
            }

            this.socket = tmpSocket;
            this.inputStream = socket.getInputStream();
            this.outputStream = socket.getOutputStream();
            this.isConnected = true;

            // Start reader thread
            startReadThread();

            final String devName = device.getName() != null ? device.getName() : address;
            mainHandler.post(() -> {
                String js = "window.obdService && window.obdService._onNativeConnected(" + JSONObject.quote(devName) + ");";
                webView.evaluateJavascript(js, null);
            });

            return true;
        } catch (Exception e) {
            Log.e(TAG, "Connect error", e);
            notifyError("Connect error: " + e.getMessage());
            disconnect();
            return false;
        }
    }

    @JavascriptInterface
    public boolean sendCommand(String cmd) {
        if (!isConnected || outputStream == null) {
            return false;
        }
        try {
            String payload = cmd + "\r";
            outputStream.write(payload.getBytes(StandardCharsets.US_ASCII));
            outputStream.flush();
            return true;
        } catch (IOException e) {
            Log.e(TAG, "Send command failed", e);
            disconnect();
            return false;
        }
    }

    @JavascriptInterface
    public void disconnect() {
        isConnected = false;
        if (readThread != null) {
            readThread.interrupt();
            readThread = null;
        }
        if (inputStream != null) {
            try { inputStream.close(); } catch (Exception ignored) {}
            inputStream = null;
        }
        if (outputStream != null) {
            try { outputStream.close(); } catch (Exception ignored) {}
            outputStream = null;
        }
        if (socket != null) {
            try { socket.close(); } catch (Exception ignored) {}
            socket = null;
        }
        mainHandler.post(() -> {
            String js = "window.obdService && window.obdService._onNativeDisconnected();";
            webView.evaluateJavascript(js, null);
        });
    }

    private void startReadThread() {
        readThread = new Thread(() -> {
            byte[] buf = new byte[1024];
            while (isConnected && inputStream != null) {
                try {
                    int n = inputStream.read(buf);
                    if (n > 0) {
                        String chunk = new String(buf, 0, n, StandardCharsets.US_ASCII);
                        mainHandler.post(() -> {
                            String js = "window.obdService && window.obdService._onNativeDataReceived(" + JSONObject.quote(chunk) + ");";
                            webView.evaluateJavascript(js, null);
                        });
                    } else if (n < 0) {
                        break;
                    }
                } catch (IOException e) {
                    break;
                }
            }
            if (isConnected) {
                disconnect();
            }
        });
        readThread.setDaemon(true);
        readThread.start();
    }

    private void notifyError(String msg) {
        mainHandler.post(() -> {
            String js = "window.obdService && window.obdService._onNativeError(" + JSONObject.quote(msg) + ");";
            webView.evaluateJavascript(js, null);
        });
    }
}
