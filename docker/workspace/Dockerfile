# MBM Book Workspace Container
# All language compilers + ML/DL libraries pre-installed
# Based on Ubuntu 22.04 LTS

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Kolkata \
    TERM=xterm-256color \
    PYTHONUNBUFFERED=1 \
    PATH="/home/user/.cargo/bin:/usr/local/go/bin:/opt/dotnet:$PATH" \
    DOTNET_ROOT=/opt/dotnet \
    GOPATH=/home/user/go

# ── System essentials ─────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget git vim nano unzip zip tar \
    build-essential gcc g++ make cmake \
    # Python 3.11
    python3.11 python3.11-dev python3-pip python3.11-venv \
    # Java 17
    openjdk-17-jdk \
    # Node.js 20
    nodejs npm \
    # Ruby
    ruby ruby-dev \
    # PHP 8.1
    php8.1-cli \
    # Lua
    lua5.4 \
    # Perl
    perl \
    # SQLite (for SQL kernel)
    sqlite3 \
    # Misc tools
    htop tree jq httpie iputils-ping netcat-openbsd \
    ca-certificates lsb-release \
    && rm -rf /var/lib/apt/lists/*

# ── Python: set python3.11 as default ────────────────────────
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python  python  /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/pip     pip     /usr/bin/pip3       1

# ── Node.js: upgrade to v20 via NodeSource ───────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g typescript ts-node yarn nodemon

# ── Go 1.22 ──────────────────────────────────────────────────
RUN curl -fsSL https://go.dev/dl/go1.22.4.linux-amd64.tar.gz | tar -C /usr/local -xz

# ── Rust ─────────────────────────────────────────────────────
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && /root/.cargo/bin/rustup default stable

# ── .NET SDK 8 ───────────────────────────────────────────────
RUN mkdir -p /opt/dotnet \
    && curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir /opt/dotnet \
    && ln -sf /opt/dotnet/dotnet /usr/local/bin/dotnet

# ── Python ML/DL libraries ───────────────────────────────────
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
        # Core scientific
        numpy pandas scipy matplotlib seaborn plotly \
        # ML
        scikit-learn xgboost lightgbm catboost \
        # DL (CPU builds — GPU via CUDA on cluster nodes)
        torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu \
        tensorflow-cpu \
        # NLP / LLM tools
        transformers datasets tokenizers \
        huggingface_hub \
        # CV
        opencv-python-headless Pillow \
        # Notebooks / REPL
        ipython jupyterlab \
        # Web / API
        requests httpx fastapi uvicorn flask aiohttp \
        # Data
        sqlalchemy pymongo redis \
        # Utils
        python-dotenv click rich tqdm pydantic \
        sympy networkx \
        # Audio
        librosa soundfile

# ── Non-root user ─────────────────────────────────────────────
RUN useradd -m -s /bin/bash -u 1000 user \
    && echo 'export PS1="\[\033[01;32m\]user@mbmbook\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "' >> /home/user/.bashrc \
    && echo 'alias ll="ls -la --color=auto"' >> /home/user/.bashrc \
    && echo 'alias py="python3"' >> /home/user/.bashrc \
    && mkdir -p /workspace \
    && chown user:user /workspace

# Copy Rust from root to user
RUN cp -r /root/.cargo /home/user/.cargo \
    && cp -r /root/.rustup /home/user/.rustup \
    && chown -R user:user /home/user/.cargo /home/user/.rustup

USER user
WORKDIR /workspace

# ── Welcome message ───────────────────────────────────────────
RUN echo 'echo ""' >> ~/.bashrc \
    && echo 'echo "  ╔════════════════════════════════════╗"' >> ~/.bashrc \
    && echo 'echo "  ║   MBM Book Workspace — Ready ✓    ║"' >> ~/.bashrc \
    && echo 'echo "  ║   Python · Node · Go · Rust · Java ║"' >> ~/.bashrc \
    && echo 'echo "  ╚════════════════════════════════════╝"' >> ~/.bashrc \
    && echo 'echo ""' >> ~/.bashrc

CMD ["/bin/bash", "--login"]
