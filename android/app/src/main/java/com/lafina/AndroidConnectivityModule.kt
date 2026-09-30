package com.lafina

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.InetAddress
import java.net.UnknownHostException

class AndroidConnectivityModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AndroidConnectivityModule"

    @ReactMethod
    fun isOnline(promise: Promise) {
        try {
            val manager = reactApplicationContext.getSystemService(
                Context.CONNECTIVITY_SERVICE
            ) as ConnectivityManager
            val activeNetwork = manager.activeNetwork
            if (activeNetwork == null) {
                promise.resolve(false)
                return
            }
            val capabilities = manager.getNetworkCapabilities(activeNetwork)
            val hasInternet = capabilities?.hasCapability(
                NetworkCapabilities.NET_CAPABILITY_INTERNET
            ) == true
            val hasTransport = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true ||
                capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true ||
                capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true ||
                capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
            promise.resolve(hasInternet || hasTransport)
        } catch (error: Exception) {
            promise.reject("CONNECTIVITY_CHECK_ERROR", error.message, error)
        }
    }

    /**
     * Whether this device can look up [host]. A request that fails without an
     * answer is most often a network whose DNS has stopped answering while the
     * connection itself is up — [isOnline] cannot tell that apart, and the
     * person needs to know which it is.
     */
    @ReactMethod
    fun canResolve(host: String, promise: Promise) {
        Thread {
            try {
                promise.resolve(InetAddress.getAllByName(host).isNotEmpty())
            } catch (error: UnknownHostException) {
                promise.resolve(false)
            } catch (error: Exception) {
                promise.resolve(false)
            }
        }.start()
    }
}
