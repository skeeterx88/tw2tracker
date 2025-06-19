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
git clone https://github.com/skeeterx88/tw2tracker.git
cd tw2tracker
```

## 5. Instale as dependências do Node.js

```sh
npm install
```

## 6. Configure as variáveis de ambiente

Execute o comando abaixo para criar a variável de ambiente.

```sh
export TW2TRACKER_SESSION_SECRET=uma-string-secreta-bem-grande-e-aleatoria
```

## 7. Suba o PostgreSQL com Docker Compose

Certifique-se de que o Docker e o Docker Compose estão instalados.  

Para instalar o Docker e o Docker Compose no Ubuntu, siga as instruções oficiais em:
https://docs.docker.com/engine/install/ubuntu/

Na raiz do projeto (onde está o `compose.yaml`):

```sh
sudo docker compose up -d
```

O banco de dados será iniciado com as credenciais já configuradas.

## 8. Rode a aplicação

```sh
npm start
```

A aplicação estará disponível na porta 3000.

---

**Pronto!**  
Agora acesse a URL http://127.0.0.1:3000

O portal admin é: http://127.0.0.1:3000/admin
```
Usuário: admin
Senha: admin
```
