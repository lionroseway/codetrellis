// A web view has nothing to host in the preview: it says so rather than rendering blank.
import { Text, View } from 'react-native';
export type WebViewMessageEvent = { nativeEvent: { data: string } };
export function WebView(): JSX.Element {
  return <View style={{ padding: 12 }}><Text style={{ color: '#71717a' }}>(web view: not rendered in the preview)</Text></View>;
}
export default WebView;
