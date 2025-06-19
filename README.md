# TW2Tracker - Guia de Instalação no Ubuntu 25

Este guia mostra como configurar e rodar o TW2Tracker em um Ubuntu 25, utilizando Node.js e PostgreSQL via Docker Compose.

---

## 1. Atualize o sistema

```sh
sudo apt update && sudo apt upgrade -y
```

## 2. Instale o Git

```sh
sudo apt install git -y
```

## 3. Instale o Node.js (LTS recomendado)

```sh
sudo apt install curl -y
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install nodejs -y
```

Verifique a instalação:
```sh
node -v
npm -v
```

## 4. Clone o repositório

```sh
git clone <URL_DO_SEU_REPOSITORIO>
cd <nome_da_pasta_do_projeto>
```

## 5. Instale as dependências do Node.js

```sh
npm install
```

## 6. Configure as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto com o seguinte conteúdo (ajuste conforme necessário):

```
PGUSER=seu_usuario
PGPASSWORD=sua_senha
PGHOST=localhost
PGDATABASE=nome_do_banco
PGPORT=5432
TW2TRACKER_SESSION_SECRET=uma-string-secreta-bem-grande-e-aleatoria
```

## 7. Suba o PostgreSQL com Docker Compose

Certifique-se de que o Docker e o Docker Compose estão instalados.  
Na raiz do projeto (onde está o `docker-compose.yml`):

```sh
docker compose up -d
```

O banco de dados será iniciado com as credenciais já configuradas.

## 8. Rode a aplicação

```sh
npm start
```

A aplicação estará disponível na porta configurada (ex: 3000).

---

**Pronto!**  
Seu ambiente está configurado para rodar o TW2Tracker
