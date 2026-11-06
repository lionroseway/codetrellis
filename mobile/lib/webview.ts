/**
 * `react-native-webview`, with its component typed so its props type-check.
 *
 * 14.x declares `class WebView<P = undefined>` with props `WebViewProps & P`,
 * which is `never` when P is left at its default, so every prop is rejected
 * (react-native-webview#3970, #3977). The fix is on their next major, and Expo
 * SDK 58 takes 14.0.1. Fixing P at `object` gives back the props the class has
 * always had; nothing changes at runtime, where the type argument is erased.
 *
 * Import `WebView` from here rather than from the package. Delete this file once
 * the SDK's version declares the default properly.
 */

import { WebView as UpstreamWebView } from 'react-native-webview';

export type { WebViewMessageEvent } from 'react-native-webview';

export const WebView = UpstreamWebView<object>;
export type WebView = UpstreamWebView<object>;
