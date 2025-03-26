FROM public.ecr.aws/lambda/nodejs:18

# Install dependencies (added xz for .tar.xz extraction)
RUN yum install -y python3 python3-pip curl tar gzip xz shadow-utils && \
    pip3 install --upgrade pip

# Install yt-dlp
RUN pip3 install yt-dlp

# Install FFmpeg (static binary, no EPEL required)
RUN curl -LO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
    tar xf ffmpeg-release-amd64-static.tar.xz && \
    rm ffmpeg-release-amd64-static.tar.xz && \
    mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ && \
    mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ && \
    rm -rf ffmpeg-*-amd64-static/

# Set permissions
RUN chmod 755 /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

# Create app directory
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy function code
COPY index.js ./

# Set the CMD to your handler
CMD [ "index.handler" ]