
type IconlyIconProps = {
    size?:number;
    color?:string;
    secondColor?:string;
}

export const IconlyProfile = ({ size = 16, color = "currentColor", secondColor = "currentColor" }: IconlyIconProps) => {
    return (
		<svg width={size} height={size} viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path fillRule="evenodd" clipRule="evenodd" d="M12.2505 13.8307C8.33752 13.8307 4.90552 16.1327 4.90552 18.7557C4.90552 22.1307 10.4345 22.1307 12.2505 22.1307C14.0665 22.1307 19.5945 22.1307 19.5945 18.7337C19.5945 16.1217 16.1625 13.8307 12.2505 13.8307Z" fill={secondColor}></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M12.212 11.6423H12.243C14.938 11.6423 17.13 9.45026 17.13 6.75526C17.13 4.06126 14.938 1.86926 12.243 1.86926C9.54805 1.86926 7.35605 4.06126 7.35605 6.75326C7.34705 9.43926 9.52405 11.6323 12.212 11.6423Z" fill={secondColor}></path>
		</svg>
    ) 
}