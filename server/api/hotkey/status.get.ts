// 查询全局停止热键状态: armed=是否在监听, triggered=触发时间戳(0=未触发)
import { hotkeyStatus } from '../../utils/hotkey';

export default defineEventHandler(() => hotkeyStatus());
