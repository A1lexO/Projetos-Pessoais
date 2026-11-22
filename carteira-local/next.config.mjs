/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pacotes que devem rodar como Node puro no servidor (não empacotar)
  serverExternalPackages: ["@prisma/client", "xlsx"],
};
export default nextConfig;
