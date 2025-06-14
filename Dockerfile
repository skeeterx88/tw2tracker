FROM nginx:alpine

# Remove o default do nginx
RUN rm /etc/nginx/conf.d/default.conf

# Copia o arquivo de configuração customizado
COPY share/nginx/sites-enabled/tw2-tracker.com.conf /etc/nginx/conf.d/tw2-tracker.com.conf

# Copia os arquivos públicos do site
COPY src /var/www/tw2tracker/src

# Copia os certificados SSL (ajuste o caminho conforme necessário)
COPY share/ssl /var/www/tw2tracker/share/ssl

# Expõe as portas necessárias
EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]