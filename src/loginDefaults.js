// 2026-11-17 安全修复：客户端绝不内置任何账号或密码。
// 首次部署由登录页创建自定义账号；之后由操作者输入，服务端只保存 scrypt 哈希。
export const LOGIN_DEFAULTS = Object.freeze({ username: "", password: "" });
